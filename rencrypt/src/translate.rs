//! Glossary translation module for multiple languages.
//!
//! This module provides a pure Rust translation workflow for glossary CSV files:
//! - loads AI provider configuration from `ai.json` or encrypted `ai.json.enc`
//! - decrypts OpenSSL `enc -aes-256-cbc -pbkdf2` payloads in-process
//! - rotates API keys in round-robin mode per provider
//! - calls provider APIs (Gemini/OpenAI-compatible/gateway)
//! - writes translated values back into the glossary CSV after every batch

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use aes::Aes256;
use anyhow::{Context, Result, anyhow};
use base64::Engine;
use cbc::cipher::{BlockDecryptMut, KeyIvInit, block_padding::Pkcs7};
use csv::{QuoteStyle, ReaderBuilder, WriterBuilder};
use pbkdf2::pbkdf2_hmac;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

type Aes256CbcDec = cbc::Decryptor<Aes256>;

const DEFAULT_TIMEOUT_SECS: u64 = 120;
const MAX_RETRIES: usize = 3;
const PREVIEW_MAX_LEN: usize = 256;

/// Translation language code (ISO 639-1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Language {
    /// English
    English,
    /// Simplified Chinese
    Chinese,
    /// Spanish
    Spanish,
    /// Portuguese
    Portuguese,
    /// German
    German,
    /// Italian
    Italian,
}

impl Language {
    /// Returns the language code (en, cn, es, pt, de, it).
    pub fn code(&self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Chinese => "cn",
            Self::Spanish => "es",
            Self::Portuguese => "pt",
            Self::German => "de",
            Self::Italian => "it",
        }
    }

    /// Returns the display name for this language.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::English => "English",
            Self::Chinese => "Simplified Chinese",
            Self::Spanish => "Spanish",
            Self::Portuguese => "Portuguese",
            Self::German => "German",
            Self::Italian => "Italian",
        }
    }

    /// Returns the glossary column name for this language.
    pub fn column_name(&self) -> &'static str {
        match self {
            Self::English => "english",
            Self::Chinese => "chinese",
            Self::Spanish => "spanish",
            Self::Portuguese => "portuguese",
            Self::German => "german",
            Self::Italian => "italian",
        }
    }

    /// Returns the default provider for this language.
    pub fn default_provider(&self) -> &'static str {
        match self {
            Self::Chinese => "gemini",
            _ => "mistral",
        }
    }

    /// Returns the default model for this language.
    pub fn default_model(&self) -> &'static str {
        match self {
            Self::Chinese => "gemini-3-flash-preview",
            _ => "mistral-medium-latest",
        }
    }

    /// Parses a language code into a Language enum.
    ///
    /// # Errors
    ///
    /// Returns an error if the code is not recognized.
    pub fn from_code(code: &str) -> Result<Self> {
        match code {
            "en" => Ok(Self::English),
            "cn" => Ok(Self::Chinese),
            "es" => Ok(Self::Spanish),
            "pt" => Ok(Self::Portuguese),
            "de" => Ok(Self::German),
            "it" => Ok(Self::Italian),
            _ => Err(anyhow!("unknown language code: {code}")),
        }
    }

    /// Returns the system prompt for this language.
    pub fn default_system_prompt(&self) -> &'static str {
        match self {
            Self::English => "You are a technical translator specialising in mechanical and electronical engineering and technical drawings. Translate French terms to English, preserving abbreviations, punctuation, and capitalisation style of the original. DXF special character codes (%%C for Ø, %%P for ±, %%D for °) and Unicode symbols (Ø, ±, °) must be preserved exactly as-is. Try to keep the same number or less characters if possible, but accuracy is more important than brevity. NOVASULF is a proper noun and should be translated as INDUSTRIAL-ANALYZER. BRISTOL MECI is a proper noun and should be translated as ISMO Group. INNOV ANALYSIS SYSTEMS is a proper noun and should be translated as ISMO Group. JLB is a proper noun and should be translated as RLM. Each translation MUST be on a single line with no line breaks. Return ONLY a valid JSON array of strings — no prose, no markdown fences.",
            Self::Chinese => "You are a technical translator specialising in mechanical and electronical engineering and technical drawings. Translate the given terms into Simplified Chinese (Mandarin, Simplified script). Both French and English are provided for context and disambiguation. Preserve punctuation marks like ':' and '.' where appropriate. DXF special character codes (%%C for Ø, %%P for ±, %%D for °) and Unicode symbols (Ø, ±, °) must be preserved exactly as-is. NOVASULF is a proper noun and should be translated as INDUSTRIAL-ANALYZER. BRISTOL MECI is a proper noun and should be translated as ISMO Group. INNOV ANALYSIS SYSTEMS is a proper noun and should be translated as ISMO Group. JLB is a proper noun and should be translated as RLM. Return ONLY a valid JSON array of strings — no prose, no markdown fences.",
            Self::Spanish => "You are a technical translator specialising in mechanical and electronical engineering and technical drawings. Translate French terms to Spanish, preserving abbreviations, punctuation, and capitalisation style of the original. DXF special character codes (%%C for Ø, %%P for ±, %%D for °) and Unicode symbols (Ø, ±, °) must be preserved exactly as-is. NOVASULF should be translated as INDUSTRIAL-ANALYZER. BRISTOL MECI should be translated as ISMO Group. INNOV ANALYSIS SYSTEMS should be translated as ISMO Group. JLB should be translated as RLM. Each translation MUST be on a single line with no line breaks. Return ONLY a valid JSON array of strings — no prose, no markdown fences.",
            Self::Portuguese => "You are a technical translator specialising in mechanical and electronical engineering and technical drawings. Translate French terms to Portuguese (Brazil), preserving abbreviations, punctuation, and capitalisation style of the original. DXF special character codes (%%C for Ø, %%P for ±, %%D for °) and Unicode symbols (Ø, ±, °) must be preserved exactly as-is. NOVASULF should be translated as INDUSTRIAL-ANALYZER. BRISTOL MECI should be translated as ISMO Group. INNOV ANALYSIS SYSTEMS should be translated as ISMO Group. JLB should be translated as RLM. Each translation MUST be on a single line with no line breaks. Return ONLY a valid JSON array of strings — no prose, no markdown fences.",
            Self::German => "You are a technical translator specialising in mechanical and electronical engineering and technical drawings. Translate French terms to German, preserving abbreviations, punctuation, and capitalisation style of the original. DXF special character codes (%%C for Ø, %%P for ±, %%D for °) and Unicode symbols (Ø, ±, °) must be preserved exactly as-is. NOVASULF should be translated as INDUSTRIAL-ANALYZER. BRISTOL MECI should be translated as ISMO Group. INNOV ANALYSIS SYSTEMS should be translated as ISMO Group. JLB should be translated as RLM. Each translation MUST be on a single line with no line breaks. Return ONLY a valid JSON array of strings — no prose, no markdown fences.",
            Self::Italian => "You are a technical translator specialising in mechanical and electronical engineering and technical drawings. Translate French terms to Italian, preserving abbreviations, punctuation, and capitalisation style of the original. DXF special character codes (%%C for Ø, %%P for ±, %%D for °) and Unicode symbols (Ø, ±, °) must be preserved exactly as-is. NOVASULF should be translated as INDUSTRIAL-ANALYZER. BRISTOL MECI should be translated as ISMO Group. INNOV ANALYSIS SYSTEMS should be translated as ISMO Group. JLB should be translated as RLM. Each translation MUST be on a single line with no line breaks. Return ONLY a valid JSON array of strings — no prose, no markdown fences.",
        }
    }
}

impl std::str::FromStr for Language {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        Self::from_code(s)
    }
}

/// Configuration for translation execution.
#[derive(Debug, Clone)]
pub struct TranslateConfig {
    /// Target language for translation
    pub language: Language,
    /// Model identifier (e.g., "mistral-medium-latest", "gemini-3-flash-preview")
    pub model: String,
    /// Provider name (e.g., "mistral", "gemini")
    pub provider: String,
    /// Batch size for API calls
    pub batch_size: usize,
    /// Use gateway mode for API calls
    pub use_gateway: bool,
    /// Path or URL to ai.json.enc configuration
    pub ai_json_enc: String,
    /// Encryption token for ai.json.enc
    pub ai_cryptoken: Option<String>,
    /// Gateway token (overrides gatewayKey)
    pub ai_gateway_token: Option<String>,
    /// Enable verbose debugging
    pub verbose: bool,
    /// Re-translate existing translations
    pub force: bool,
    /// Custom system prompt (overrides default)
    pub prompt_system: Option<String>,
    /// Custom user prompt (supports placeholders {count} and {items})
    pub prompt_user: Option<String>,
}

impl Default for TranslateConfig {
    fn default() -> Self {
        let language = Language::English;
        Self {
            language,
            model: language.default_model().to_string(),
            provider: language.default_provider().to_string(),
            batch_size: 50,
            use_gateway: false,
            ai_json_enc: "./ai.json.enc".to_string(),
            ai_cryptoken: None,
            ai_gateway_token: None,
            verbose: false,
            force: false,
            prompt_system: None,
            prompt_user: None,
        }
    }
}

/// Summary of a translation operation.
#[derive(Debug, Clone)]
pub struct TranslateSummary {
    /// Number of translations completed
    pub translated: usize,
    /// Number of translations that failed
    pub failed: usize,
}

#[derive(Debug, Clone)]
struct Glossary {
    headers: Vec<String>,
    rows: Vec<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AiConfig {
    providers: HashMap<String, ProviderConfig>,
}

#[derive(Debug, Deserialize)]
struct ProviderConfig {
    protocol: String,
    endpoint: Option<String>,
    #[serde(default)]
    keys: Vec<ProviderKey>,
    #[serde(rename = "gatewayEndpoint")]
    gateway_endpoint: Option<String>,
    #[serde(rename = "gatewayModelPrefix")]
    gateway_model_prefix: Option<String>,
    #[serde(rename = "gatewayKey")]
    gateway_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderKey {
    key: String,
    #[serde(rename = "type")]
    key_type: Option<String>,
}

struct AiClient {
    config: AiConfig,
    key_indices: HashMap<String, usize>,
    gateway_token: Option<String>,
    verbose: bool,
    http: Client,
}

impl AiClient {
    fn new(
        config_path: &str,
        cryptoken: Option<&str>,
        gateway_token: Option<&str>,
        verbose: bool,
    ) -> Result<Self> {
        let config = load_ai_config(config_path, cryptoken)?;
        let http = Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .build()
            .context("failed to build HTTP client")?;

        Ok(Self {
            config,
            key_indices: HashMap::new(),
            gateway_token: gateway_token.map(ToOwned::to_owned),
            verbose,
            http,
        })
    }

    fn log(&self, message: &str) {
        if self.verbose {
            eprintln!("[ai_client] {message}");
        }
    }

    fn next_key(&mut self, provider: &str) -> Result<String> {
        let pconf = self
            .config
            .providers
            .get(provider)
            .ok_or_else(|| anyhow!("unknown provider {provider:?}"))?;

        let valid_keys: Vec<&str> = pconf
            .keys
            .iter()
            .filter(|k| k.key_type.as_deref() != Some("expired"))
            .map(|k| k.key.as_str())
            .collect();

        if valid_keys.is_empty() {
            return Err(anyhow!("no valid keys for provider {provider:?}"));
        }

        let idx = self.key_indices.get(provider).copied().unwrap_or(0) % valid_keys.len();
        self.key_indices
            .insert(provider.to_string(), (idx + 1) % valid_keys.len());

        Ok(valid_keys[idx].to_string())
    }

    fn chat(
        &mut self,
        provider: &str,
        model_id: &str,
        messages: &[ChatMessage],
        use_gateway: bool,
    ) -> Result<String> {
        let protocol = self
            .config
            .providers
            .get(provider)
            .ok_or_else(|| anyhow!("unknown provider {provider:?}"))?
            .protocol
            .clone();

        self.log(&format!(
            "chat provider={provider} model={model_id} gateway={use_gateway} protocol={protocol}"
        ));

        let mut last_err: Option<anyhow::Error> = None;

        for attempt in 0..MAX_RETRIES {
            let call_result = if use_gateway {
                self.chat_gateway(provider, model_id, messages)
            } else if protocol == "gemini" {
                self.chat_gemini(provider, model_id, messages)
            } else if protocol == "openai" || protocol == "anthropic" {
                self.chat_openai(provider, model_id, messages)
            } else {
                Err(anyhow!("unsupported protocol: {protocol}"))
            };

            match call_result {
                Ok(text) => return Ok(text),
                Err(err) => {
                    let is_429 = err
                        .downcast_ref::<HttpStatusError>()
                        .map(|e| e.status == 429)
                        .unwrap_or(false);

                    if is_429 && attempt + 1 < MAX_RETRIES {
                        self.log(&format!(
                            "HTTP 429 on provider={provider}, retry {} of {}",
                            attempt + 1,
                            MAX_RETRIES
                        ));
                        thread::sleep(Duration::from_secs(1_u64 << attempt));
                        last_err = Some(err);
                        continue;
                    }

                    if attempt + 1 < MAX_RETRIES {
                        thread::sleep(Duration::from_secs(1_u64 << attempt));
                        last_err = Some(err);
                        continue;
                    }

                    return Err(err);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| anyhow!("unknown chat failure")))
    }

    fn chat_gemini(
        &mut self,
        provider: &str,
        model_id: &str,
        messages: &[ChatMessage],
    ) -> Result<String> {
        let key = self.next_key(provider)?;
        let pconf = self
            .config
            .providers
            .get(provider)
            .ok_or_else(|| anyhow!("unknown provider {provider:?}"))?;

        let endpoint = pconf
            .endpoint
            .as_deref()
            .ok_or_else(|| anyhow!("provider {provider:?} is missing endpoint"))?;
        let url = format!(
            "{}/models/{}:generateContent?key={}",
            endpoint.trim_end_matches('/'),
            model_id,
            key
        );

        let mut system_text: Option<&str> = None;
        let mut contents: Vec<Value> = Vec::new();
        for msg in messages {
            if msg.role == "system" {
                system_text = Some(&msg.content);
            } else {
                let role = if msg.role == "user" { "user" } else { "model" };
                contents.push(json!({
                    "role": role,
                    "parts": [{"text": msg.content}],
                }));
            }
        }

        let mut body = json!({"contents": contents});
        if let Some(system) = system_text {
            body["system_instruction"] = json!({"parts": [{"text": system}]});
        }

        self.log(&format!("POST {url}"));
        self.log(&format!("payload {}", payload_preview(&body)));

        let response = self
            .http
            .post(url)
            .json(&body)
            .send()
            .context("gemini request failed")?;
        let status = response.status().as_u16();
        let body_text = response.text().unwrap_or_default();

        self.log(&format!("response status={status}"));
        self.log(&format!("response body {}", truncate_string(&body_text, 2_000)));

        if status >= 400 {
            return Err(HttpStatusError::new(status, body_text).into());
        }

        let data: Value = serde_json::from_str(&body_text)
            .context("gemini response is not valid JSON")?;
        let text = data
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|part| part.get("text"))
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("gemini response missing candidates[0].content.parts[0].text"))?;

        Ok(text.to_string())
    }

    fn chat_openai(
        &mut self,
        provider: &str,
        model_id: &str,
        messages: &[ChatMessage],
    ) -> Result<String> {
        let key = self.next_key(provider)?;
        let pconf = self
            .config
            .providers
            .get(provider)
            .ok_or_else(|| anyhow!("unknown provider {provider:?}"))?;

        let endpoint = pconf
            .endpoint
            .as_deref()
            .ok_or_else(|| anyhow!("provider {provider:?} is missing endpoint"))?;
        let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

        let payload = json!({
            "model": model_id,
            "messages": messages,
        });

        self.log(&format!("POST {url}"));
        self.log(&format!("payload {}", payload_preview(&payload)));

        let response = self
            .http
            .post(url)
            .header("Authorization", format!("Bearer {key}"))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .context("openai-compatible request failed")?;

        let status = response.status().as_u16();
        let body_text = response.text().unwrap_or_default();

        self.log(&format!("response status={status}"));
        self.log(&format!("response body {}", truncate_string(&body_text, 2_000)));

        if status >= 400 {
            return Err(HttpStatusError::new(status, body_text).into());
        }

        let data: Value = serde_json::from_str(&body_text)
            .context("openai-compatible response is not valid JSON")?;
        let text = data
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("openai-compatible response missing choices[0].message.content"))?;

        Ok(text.to_string())
    }

    fn chat_gateway(
        &mut self,
        provider: &str,
        model_id: &str,
        messages: &[ChatMessage],
    ) -> Result<String> {
        let provider_key = self.next_key(provider)?;
        let pconf = self
            .config
            .providers
            .get(provider)
            .ok_or_else(|| anyhow!("unknown provider {provider:?}"))?;

        let endpoint = pconf
            .gateway_endpoint
            .as_deref()
            .ok_or_else(|| anyhow!("provider {provider:?} is missing gatewayEndpoint"))?;
        let model_prefix = pconf
            .gateway_model_prefix
            .as_deref()
            .ok_or_else(|| anyhow!("provider {provider:?} is missing gatewayModelPrefix"))?;

        let gateway_key = self
            .gateway_token
            .clone()
            .or_else(|| env::var("AI_GATEWAY_TOKEN").ok())
            .or_else(|| pconf.gateway_key.clone())
            .ok_or_else(|| {
                anyhow!(
                    "gateway mode enabled but provider is missing gateway token: pass --ai-gateway-token, set AI_GATEWAY_TOKEN, or configure gatewayKey"
                )
            })?;

        let url = if endpoint.trim_end_matches('/').ends_with("/chat/completions") {
            endpoint.to_string()
        } else {
            format!("{}/chat/completions", endpoint.trim_end_matches('/'))
        };

        let gateway_model = if model_prefix.ends_with('/') {
            format!("{}{}", model_prefix, model_id.trim_start_matches('/'))
        } else {
            format!("{}/{}", model_prefix, model_id.trim_start_matches('/'))
        };

        let payload = json!({
            "model": gateway_model,
            "messages": messages,
        });

        self.log(&format!("POST {url}"));
        self.log(&format!("payload {}", payload_preview(&payload)));

        let response = self
            .http
            .post(url)
            .header("Authorization", format!("Bearer {provider_key}"))
            .header("cf-aig-authorization", format!("Bearer {gateway_key}"))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .context("gateway request failed")?;

        let status = response.status().as_u16();
        let body_text = response.text().unwrap_or_default();

        self.log(&format!("response status={status}"));
        self.log(&format!("response body {}", truncate_string(&body_text, 2_000)));

        if status >= 400 {
            return Err(HttpStatusError::new(status, body_text).into());
        }

        let data: Value = serde_json::from_str(&body_text)
            .context("gateway response is not valid JSON")?;
        let text = data
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("gateway response missing choices[0].message.content"))?;

        Ok(text.to_string())
    }
}

#[derive(Debug)]
struct HttpStatusError {
    status: u16,
    body: String,
}

impl HttpStatusError {
    fn new(status: u16, body: String) -> Self {
        Self { status, body }
    }
}

impl std::fmt::Display for HttpStatusError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "HTTP {}: {}",
            self.status,
            truncate_string(&self.body, 512)
        )
    }
}

impl std::error::Error for HttpStatusError {}

/// Executes a pure Rust translation workflow over `glossaire.csv`.
///
/// # Errors
///
/// Returns an error if glossary loading, AI config loading, API calls, or CSV writing fails.
pub fn run_translate(glossary_path: &Path, config: &TranslateConfig) -> Result<TranslateSummary> {
    if !glossary_path.exists() {
        return Err(anyhow!(
            "glossaire.csv not found at {}",
            glossary_path.display()
        ));
    }

    let mut glossary = load_glossary(glossary_path)?;
    let language = config.language;
    ensure_column(&mut glossary, language.column_name());

    let pending_indices = pending_rows(&glossary, config);

    if pending_indices.is_empty() {
        println!(
            "All eligible rows already have {} translations. Nothing to do.",
            language.display_name()
        );
        return Ok(TranslateSummary {
            translated: 0,
            failed: 0,
        });
    }

    println!(
        "{} rows need {} translation (batch size: {}, model: {}/{}, gateway: {})",
        pending_indices.len(),
        language.display_name(),
        config.batch_size,
        config.provider,
        config.model,
        if config.use_gateway { "on" } else { "off" }
    );

    let mut client = AiClient::new(
        &config.ai_json_enc,
        config.ai_cryptoken.as_deref(),
        config.ai_gateway_token.as_deref(),
        config.verbose,
    )
    .context("failed to initialize AI client")?;

    let mut translated_total = 0usize;
    let mut failed_total = 0usize;

    let batch_size = config.batch_size.max(1);
    for (batch_index, batch) in pending_indices.chunks(batch_size).enumerate() {
        println!(
            "  Batch {} ({}-{} / {}) ...",
            batch_index + 1,
            batch_index * batch_size + 1,
            batch_index * batch_size + batch.len(),
            pending_indices.len()
        );

        match translate_with_split(&mut client, &glossary, batch, config) {
            Ok(translations) => {
                for (row_idx, translated) in batch.iter().zip(translations) {
                    glossary.rows[*row_idx]
                        .insert(language.column_name().to_string(), translated.trim().to_string());
                }
                translated_total += batch.len();
                println!("    OK ({})", batch.len());
            }
            Err(err) => {
                failed_total += batch.len();
                println!("    FAILED: {err}");
            }
        }

        save_glossary(glossary_path, &glossary)?;
    }

    println!(
        "Done. {} translated, {} failed. Saved to {}",
        translated_total,
        failed_total,
        glossary_path.display()
    );

    Ok(TranslateSummary {
        translated: translated_total,
        failed: failed_total,
    })
}

fn pending_rows(glossary: &Glossary, config: &TranslateConfig) -> Vec<usize> {
    let target = config.language.column_name();

    if config.language == Language::Chinese {
        let skipped_no_en = glossary
            .rows
            .iter()
            .filter(|r| value(r, "english").is_empty())
            .count();
        if skipped_no_en > 0 {
            println!(
                "Note: {} rows skipped (no English value, required before Chinese translation).",
                skipped_no_en
            );
        }

        glossary
            .rows
            .iter()
            .enumerate()
            .filter_map(|(i, row)| {
                let has_english = !value(row, "english").is_empty();
                let has_target = !value(row, target).is_empty();
                if has_english && (config.force || !has_target) {
                    Some(i)
                } else {
                    None
                }
            })
            .collect()
    } else {
        glossary
            .rows
            .iter()
            .enumerate()
            .filter_map(|(i, row)| {
                let has_target = !value(row, target).is_empty();
                if config.force || !has_target {
                    Some(i)
                } else {
                    None
                }
            })
            .collect()
    }
}

fn translate_with_split(
    client: &mut AiClient,
    glossary: &Glossary,
    batch_rows: &[usize],
    config: &TranslateConfig,
) -> Result<Vec<String>> {
    match translate_batch(client, glossary, batch_rows, config) {
        Ok(v) => Ok(v),
        Err(err) => {
            if batch_rows.len() <= 1 {
                return Err(err);
            }
            let mid = batch_rows.len() / 2;
            let left = translate_with_split(client, glossary, &batch_rows[..mid], config)?;
            let right = translate_with_split(client, glossary, &batch_rows[mid..], config)?;
            Ok(left.into_iter().chain(right).collect())
        }
    }
}

fn translate_batch(
    client: &mut AiClient,
    glossary: &Glossary,
    batch_rows: &[usize],
    config: &TranslateConfig,
) -> Result<Vec<String>> {
    let system_prompt = config
        .prompt_system
        .as_deref()
        .unwrap_or_else(|| config.language.default_system_prompt());

    let (numbered_items, default_user_prompt) = build_user_prompt(glossary, batch_rows, config.language);

    let user_prompt = config
        .prompt_user
        .as_ref()
        .map(|custom| {
            custom
                .replace("{count}", &batch_rows.len().to_string())
                .replace("{items}", &numbered_items)
        })
        .unwrap_or(default_user_prompt);

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_prompt,
        },
    ];

    let response = client.chat(
        &config.provider,
        &config.model,
        &messages,
        config.use_gateway,
    )?;

    let translations = parse_json_array(&response).context("failed to parse model JSON array")?;

    if translations.len() != batch_rows.len() {
        return Err(anyhow!(
            "expected {} translations, got {}. Response preview: {}",
            batch_rows.len(),
            translations.len(),
            truncate_string(&response, 400)
        ));
    }

    Ok(translations)
}

fn build_user_prompt(glossary: &Glossary, batch_rows: &[usize], language: Language) -> (String, String) {
    if language == Language::Chinese {
        let items = batch_rows
            .iter()
            .enumerate()
            .map(|(idx, row_idx)| {
                let row = &glossary.rows[*row_idx];
                format!(
                    "{}. FR: \"{}\" | EN: \"{}\"",
                    idx + 1,
                    value(row, "french"),
                    value(row, "english")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "Translate these {} technical drawing terms to Simplified Chinese.\nReturn ONLY a JSON array of exactly {} strings in the same order.\n\n{}",
            batch_rows.len(),
            batch_rows.len(),
            items
        );

        return (items, prompt);
    }

    let items = batch_rows
        .iter()
        .enumerate()
        .map(|(idx, row_idx)| {
            let row = &glossary.rows[*row_idx];
            format!("{}. \"{}\"", idx + 1, value(row, "french"))
        })
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "Translate these {} French technical drawing terms to {}.\nReturn ONLY a JSON array of exactly {} strings in the same order.\n\n{}",
        batch_rows.len(),
        language.display_name(),
        batch_rows.len(),
        items
    );

    (items, prompt)
}

fn value<'a>(row: &'a HashMap<String, String>, key: &str) -> &'a str {
    row.get(key).map(String::as_str).unwrap_or("").trim()
}

fn load_glossary(path: &Path) -> Result<Glossary> {
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .from_path(path)
        .with_context(|| format!("failed to open glossary {}", path.display()))?;

    let headers: Vec<String> = reader
        .headers()
        .context("failed to read glossary headers")?
        .iter()
        .map(ToOwned::to_owned)
        .collect();

    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.context("failed to read glossary record")?;
        let mut row = HashMap::new();
        for (header, value) in headers.iter().zip(record.iter()) {
            row.insert(header.clone(), value.to_string());
        }
        rows.push(row);
    }

    Ok(Glossary { headers, rows })
}

fn ensure_column(glossary: &mut Glossary, column: &str) {
    if glossary.headers.iter().any(|h| h == column) {
        return;
    }
    glossary.headers.push(column.to_string());
    for row in &mut glossary.rows {
        row.entry(column.to_string()).or_insert_with(String::new);
    }
}

fn save_glossary(path: &Path, glossary: &Glossary) -> Result<()> {
    let mut writer = WriterBuilder::new()
        .has_headers(true)
        .quote_style(QuoteStyle::Always)
        .from_path(path)
        .with_context(|| format!("failed to create glossary {}", path.display()))?;

    writer
        .write_record(glossary.headers.iter())
        .context("failed to write glossary headers")?;

    for row in &glossary.rows {
        let values: Vec<String> = glossary
            .headers
            .iter()
            .map(|h| row.get(h).cloned().unwrap_or_default())
            .collect();
        writer
            .write_record(values.iter())
            .context("failed to write glossary row")?;
    }

    writer.flush().context("failed to flush glossary file")?;
    Ok(())
}

fn is_url(path_or_url: &str) -> bool {
    path_or_url.starts_with("http://") || path_or_url.starts_with("https://")
}

fn resolve_cryptoken(cryptoken: Option<&str>) -> Option<String> {
    cryptoken
        .map(ToOwned::to_owned)
        .or_else(|| env::var("AI_CRYPTOKEN").ok())
}

fn load_ai_config(path_or_url: &str, cryptoken: Option<&str>) -> Result<AiConfig> {
    if is_url(path_or_url) {
        let client = Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .build()
            .context("failed to build HTTP client")?;
        let response = client
            .get(path_or_url)
            .send()
            .with_context(|| format!("failed to download AI config from {path_or_url}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(anyhow!(
                "failed to download AI config from {path_or_url}: HTTP {}",
                status
            ));
        }

        if path_or_url.ends_with(".enc") {
            let enc_bytes = response.bytes().context("failed to read encrypted config")?;
            let token = resolve_cryptoken(cryptoken).ok_or_else(|| {
                anyhow!(
                    "cannot load encrypted AI config: set AI_CRYPTOKEN or pass --ai-cryptoken"
                )
            })?;
            let plain = decrypt_openssl_enc_base64(enc_bytes.as_ref(), &token)?;
            return serde_json::from_slice::<AiConfig>(&plain)
                .context("failed to parse decrypted AI JSON config");
        }

        let text = response.text().context("failed to read AI config body")?;
        return serde_json::from_str::<AiConfig>(&text).context("failed to parse AI JSON config");
    }

    let path = PathBuf::from(path_or_url);
    if path.extension().and_then(|s| s.to_str()) == Some("enc") {
        if let Some(token) = resolve_cryptoken(cryptoken) {
            let enc_bytes = fs::read(&path)
                .with_context(|| format!("failed to read encrypted AI config {}", path.display()))?;
            let plain = decrypt_openssl_enc_base64(&enc_bytes, &token)
                .context("failed to decrypt ai.json.enc")?;
            return serde_json::from_slice::<AiConfig>(&plain)
                .context("failed to parse decrypted AI JSON config");
        }

        let plain_path = path.with_extension("");
        if plain_path.exists() {
            let plain = fs::read_to_string(&plain_path)
                .with_context(|| format!("failed to read fallback config {}", plain_path.display()))?;
            return serde_json::from_str::<AiConfig>(&plain)
                .with_context(|| format!("failed to parse fallback config {}", plain_path.display()));
        }

        return Err(anyhow!(
            "cannot load AI config: set AI_CRYPTOKEN or pass --ai-cryptoken, or provide {}",
            plain_path.display()
        ));
    }

    let plain = fs::read_to_string(&path)
        .with_context(|| format!("failed to read AI config {}", path.display()))?;
    serde_json::from_str::<AiConfig>(&plain)
        .with_context(|| format!("failed to parse AI config {}", path.display()))
}

fn decrypt_openssl_enc_base64(encoded: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    let compact = encoded
        .iter()
        .copied()
        .filter(|b| !b.is_ascii_whitespace())
        .collect::<Vec<u8>>();

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(compact)
        .context("base64 decode failed for encrypted config")?;

    if decoded.len() < 16 || &decoded[..8] != b"Salted__" {
        return Err(anyhow!(
            "encrypted config does not contain OpenSSL Salted__ header"
        ));
    }

    let salt = &decoded[8..16];
    let ciphertext = &decoded[16..];

    let mut key_iv = [0u8; 48];
    pbkdf2_hmac::<sha2::Sha256>(passphrase.as_bytes(), salt, 100_000, &mut key_iv);

    let key = &key_iv[..32];
    let iv = &key_iv[32..48];
    let mut buf = ciphertext.to_vec();

    let plaintext = Aes256CbcDec::new_from_slices(key, iv)
        .context("failed to initialize AES-256-CBC decryptor")?
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| anyhow!("AES-256-CBC decryption failed (bad token or corrupted data)"))?
        .to_vec();

    Ok(plaintext)
}

fn truncate_string(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        value.to_string()
    } else {
        let truncated: String = value.chars().take(max_len).collect();
        format!("{truncated}...")
    }
}

fn payload_preview(value: &Value) -> String {
    fn transform(v: &Value) -> Value {
        match v {
            Value::String(s) => Value::String(truncate_string(s, PREVIEW_MAX_LEN)),
            Value::Array(arr) => Value::Array(arr.iter().map(transform).collect()),
            Value::Object(map) => {
                let mut out = serde_json::Map::new();
                for (k, v) in map {
                    out.insert(k.clone(), transform(v));
                }
                Value::Object(out)
            }
            _ => v.clone(),
        }
    }

    serde_json::to_string(&transform(value)).unwrap_or_else(|_| "<invalid-json>".to_string())
}

/// Extracts a JSON array of strings from a model response.
fn parse_json_array(response: &str) -> Result<Vec<String>> {
    let mut text = response.trim().to_string();

    if text.starts_with("```") {
        if let Some(pos) = text.find('\n') {
            text = text[(pos + 1)..].to_string();
        }
    }
    if text.ends_with("```") {
        text = text.trim_end_matches('`').trim().to_string();
    }

    if let Ok(values) = try_parse_array(&text) {
        return Ok(values);
    }

    if let (Some(start), Some(end)) = (text.find('['), text.rfind(']'))
        && start <= end
    {
        let slice = &text[start..=end];
        if let Ok(values) = try_parse_array(slice) {
            return Ok(values);
        }
    }

    let fixed = fix_literal_newlines_in_json_strings(&text);
    if let Ok(values) = try_parse_array(&fixed) {
        return Ok(values);
    }

    Err(anyhow!(
        "response does not contain a valid JSON string array. Preview: {}",
        truncate_string(response, 400)
    ))
}

fn try_parse_array(text: &str) -> Result<Vec<String>> {
    let parsed: Value = serde_json::from_str(text).context("invalid JSON")?;
    let arr = parsed
        .as_array()
        .ok_or_else(|| anyhow!("JSON root is not an array"))?;

    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        out.push(
            item.as_str()
                .ok_or_else(|| anyhow!("JSON array contains a non-string item"))?
                .to_string(),
        );
    }
    Ok(out)
}

fn fix_literal_newlines_in_json_strings(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_string = false;
    let mut escaped = false;

    for ch in text.chars() {
        if in_string {
            if escaped {
                out.push(ch);
                escaped = false;
                continue;
            }
            if ch == '\\' {
                out.push(ch);
                escaped = true;
                continue;
            }
            if ch == '"' {
                out.push(ch);
                in_string = false;
                continue;
            }
            if ch == '\n' || ch == '\r' {
                out.push(' ');
                continue;
            }
            out.push(ch);
            continue;
        }

        if ch == '"' {
            in_string = true;
        }
        out.push(ch);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_code() {
        assert_eq!(Language::English.code(), "en");
        assert_eq!(Language::Chinese.code(), "cn");
        assert_eq!(Language::Spanish.code(), "es");
        assert_eq!(Language::Portuguese.code(), "pt");
        assert_eq!(Language::German.code(), "de");
        assert_eq!(Language::Italian.code(), "it");
    }

    #[test]
    fn test_language_display_name() {
        assert_eq!(Language::English.display_name(), "English");
        assert_eq!(Language::Chinese.display_name(), "Simplified Chinese");
        assert_eq!(Language::Spanish.display_name(), "Spanish");
        assert_eq!(Language::Portuguese.display_name(), "Portuguese");
        assert_eq!(Language::German.display_name(), "German");
        assert_eq!(Language::Italian.display_name(), "Italian");
    }

    #[test]
    fn test_language_from_code() {
        assert_eq!(Language::from_code("en").unwrap(), Language::English);
        assert_eq!(Language::from_code("cn").unwrap(), Language::Chinese);
        assert_eq!(Language::from_code("es").unwrap(), Language::Spanish);
        assert_eq!(Language::from_code("pt").unwrap(), Language::Portuguese);
        assert_eq!(Language::from_code("de").unwrap(), Language::German);
        assert_eq!(Language::from_code("it").unwrap(), Language::Italian);
        assert!(Language::from_code("xx").is_err());
    }

    #[test]
    fn test_language_from_str() {
        let lang: Language = "es".parse().unwrap();
        assert_eq!(lang, Language::Spanish);
        let lang: Language = "pt".parse().unwrap();
        assert_eq!(lang, Language::Portuguese);
    }

    #[test]
    fn test_default_config() {
        let config = TranslateConfig::default();
        assert_eq!(config.language, Language::English);
        assert_eq!(config.batch_size, 50);
        assert!(!config.use_gateway);
        assert!(!config.verbose);
        assert!(!config.force);
        assert_eq!(config.ai_json_enc, "./ai.json.enc");
        assert_eq!(config.model, "mistral-medium-latest");
        assert_eq!(config.provider, "mistral");
    }

    #[test]
    fn test_config_with_custom_values() {
        let mut config = TranslateConfig::default();
        config.language = Language::Chinese;
        config.batch_size = 100;
        config.use_gateway = true;
        config.verbose = true;
        config.force = true;
        config.ai_cryptoken = Some("test_token".to_string());
        config.ai_gateway_token = Some("gateway_token".to_string());
        config.prompt_system = Some("Custom system".to_string());
        config.prompt_user = Some("Custom user".to_string());

        assert_eq!(config.language, Language::Chinese);
        assert_eq!(config.batch_size, 100);
        assert!(config.use_gateway);
        assert!(config.verbose);
        assert!(config.force);
        assert_eq!(config.ai_cryptoken.as_deref(), Some("test_token"));
        assert_eq!(config.ai_gateway_token.as_deref(), Some("gateway_token"));
        assert_eq!(config.prompt_system.as_deref(), Some("Custom system"));
        assert_eq!(config.prompt_user.as_deref(), Some("Custom user"));
    }

    #[test]
    fn test_parse_json_array_plain() {
        let parsed = parse_json_array("[\"a\", \"b\"]").unwrap();
        assert_eq!(parsed, vec!["a", "b"]);
    }

    #[test]
    fn test_parse_json_array_markdown_fence() {
        let parsed = parse_json_array("```json\n[\"x\"]\n```").unwrap();
        assert_eq!(parsed, vec!["x"]);
    }

    #[test]
    fn test_parse_json_array_with_prose() {
        let parsed = parse_json_array("Here is output:\n[\"x\",\"y\"]\nThanks").unwrap();
        assert_eq!(parsed, vec!["x", "y"]);
    }

    #[test]
    fn test_fix_literal_newlines() {
        let broken = "[\"hello\nworld\"]";
        let fixed = fix_literal_newlines_in_json_strings(broken);
        let parsed = try_parse_array(&fixed).unwrap();
        assert_eq!(parsed, vec!["hello world"]);
    }

    #[test]
    fn test_truncate_string_preserves_utf8_boundaries() {
        let value = format!("{}a", "Ø".repeat(200));
        let truncated = truncate_string(&value, 128);

        assert!(truncated.ends_with("..."));
        assert_eq!(truncated.chars().count(), 131);
        assert!(std::str::from_utf8(truncated.as_bytes()).is_ok());
    }

    #[test]
    fn test_round_robin_skips_expired() {
        let config_json = r#"{
          "providers": {
            "mistral": {
              "protocol": "openai",
              "endpoint": "https://example.invalid/v1",
              "keys": [
                {"key": "k-expired", "type": "expired"},
                {"key": "k1"},
                {"key": "k2"}
              ]
            }
          }
        }"#;

        let config: AiConfig = serde_json::from_str(config_json).unwrap();
        let http = Client::builder().build().unwrap();
        let mut client = AiClient {
            config,
            key_indices: HashMap::new(),
            gateway_token: None,
            verbose: false,
            http,
        };

        assert_eq!(client.next_key("mistral").unwrap(), "k1");
        assert_eq!(client.next_key("mistral").unwrap(), "k2");
        assert_eq!(client.next_key("mistral").unwrap(), "k1");
    }

    #[test]
    fn test_system_prompt_languages() {
        assert!(!Language::English.default_system_prompt().is_empty());
        assert!(!Language::Chinese.default_system_prompt().is_empty());
        assert!(!Language::Spanish.default_system_prompt().is_empty());
        assert!(!Language::Portuguese.default_system_prompt().is_empty());
        assert!(!Language::German.default_system_prompt().is_empty());
        assert!(!Language::Italian.default_system_prompt().is_empty());

        assert!(Language::English.default_system_prompt().contains("English"));
        assert!(Language::Chinese.default_system_prompt().contains("Chinese"));
        assert!(Language::Spanish.default_system_prompt().contains("Spanish"));
        assert!(Language::Portuguese.default_system_prompt().contains("Portuguese"));
        assert!(Language::German.default_system_prompt().contains("German"));
        assert!(Language::Italian.default_system_prompt().contains("Italian"));
    }

    #[test]
    fn test_system_prompt_contains_proper_nouns() {
        for lang in &[
            Language::English,
            Language::Chinese,
            Language::Spanish,
            Language::Portuguese,
            Language::German,
            Language::Italian,
        ] {
            let prompt = lang.default_system_prompt();
            assert!(prompt.contains("NOVASULF"));
            assert!(prompt.contains("INDUSTRIAL-ANALYZER"));
            assert!(prompt.contains("BRISTOL MECI"));
            assert!(prompt.contains("ISMO Group"));
        }
    }

    #[test]
    fn test_translate_summary_default() {
        let summary = TranslateSummary {
            translated: 100,
            failed: 5,
        };
        assert_eq!(summary.translated, 100);
        assert_eq!(summary.failed, 5);
    }
}
