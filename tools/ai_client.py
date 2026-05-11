# Copyright (c) Ronan Le Meillat - SCTG Development 2008-2026
# Licensed under the MIT License
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
"""
AI API client with round-robin key rotation.

Reads ai.json.enc and decrypts in-memory using AI_CRYPTOKEN env var.
Falls back to ai.json if AI_CRYPTOKEN is not set or enc file does not exist.

Supported protocols:
  - gemini   : Google Generative Language API (native)
  - openai   : OpenAI-compatible REST API (Mistral, Groq, OpenRouter)
  - anthropic: Anthropic (openai-compatible messages format via compat gateway)
"""

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests


class AIClient:
    DEFAULT_TIMEOUT = 120  # seconds per request
    MAX_RETRIES = 3

    def __init__(
        self,
        config_path: Optional[str | Path] = None,
        cryptoken: Optional[str] = None,
        gateway_token: Optional[str] = None,
        verbose: bool = False,
    ):
        if config_path is None:
            project_root = Path(__file__).parent.parent
            enc_path = project_root / "ai.json.enc"
            plain_path = project_root / "ai.json"
            config_path = enc_path if enc_path.exists() else plain_path

        self._cryptoken = cryptoken
        self._gateway_token = gateway_token
        self._verbose = verbose
        self._config = self._load_config(config_path)
        self._key_indices: dict[str, int] = {}

    def _log(self, *args, **kwargs) -> None:
        if self._verbose:
            print("[ai_client]", *args, **kwargs)

    @staticmethod
    def _truncate_string(value: str, max_length: int = 256) -> str:
        return value if len(value) <= max_length else value[:max_length] + "..."

    def _preview_payload(self, payload: dict) -> dict:
        def _preview_value(value):
            if isinstance(value, str):
                return self._truncate_string(value)
            if isinstance(value, dict):
                return {k: _preview_value(v) for k, v in value.items()}
            if isinstance(value, list):
                return [_preview_value(v) for v in value]
            return value

        return {k: _preview_value(v) for k, v in payload.items()}

    @staticmethod
    def _redact_headers(headers: dict) -> dict:
        return {
            k: ("Bearer ***" if k.lower() == "authorization" else v)
            for k, v in headers.items()
        }

    # ------------------------------------------------------------------
    # Config loading
    # ------------------------------------------------------------------

    @staticmethod
    def _is_url(path: str | Path) -> bool:
        if isinstance(path, Path):
            path = str(path)
        parsed = urlparse(path)
        return parsed.scheme in ("http", "https")

    def _decrypt_encoded_bytes(self, encoded: bytes) -> dict:
        cryptoken = self._cryptoken or os.environ.get("AI_CRYPTOKEN")
        if not cryptoken:
            raise RuntimeError(
                "Cannot load AI config from encrypted source: set AI_CRYPTOKEN env var or pass --ai-cryptoken."
            )
        result = subprocess.run(
            [
                "openssl", "enc", "-d", "-aes-256-cbc", "-a",
                "-pbkdf2", "-iter", "100000",
                "-in", "/dev/stdin",
                "-pass", f"pass:{cryptoken}",
            ],
            input=encoded,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout.decode("utf-8"))

    def _load_config(self, path: str | Path) -> dict:
        if self._is_url(path):
            url = str(path)
            resp = requests.get(url, timeout=self.DEFAULT_TIMEOUT)
            resp.raise_for_status()
            if url.endswith(".enc"):
                return self._decrypt_encoded_bytes(resp.content)
            return json.loads(resp.text)

        path = Path(path)
        if path.suffix == ".enc":
            cryptoken = self._cryptoken or os.environ.get("AI_CRYPTOKEN")
            plain_path = path.with_suffix("")
            if cryptoken:
                result = subprocess.run(
                    [
                        "openssl", "enc", "-d", "-aes-256-cbc", "-a",
                        "-pbkdf2", "-iter", "100000",
                        "-in", str(path),
                        "-pass", f"pass:{cryptoken}",
                    ],
                    capture_output=True,
                    check=True,
                )
                return json.loads(result.stdout.decode("utf-8"))
            elif plain_path.exists():
                return json.loads(plain_path.read_text(encoding="utf-8"))
            else:
                raise RuntimeError(
                    "Cannot load AI config: set AI_CRYPTOKEN env var or pass --ai-cryptoken, or ensure "
                    f"{plain_path} exists.\n"
                    "Decrypt with: source .env && openssl enc -d -aes-256-cbc "
                    "-a -pbkdf2 -iter 100000 -in ai.json.enc -out ai.json "
                    '-pass pass:"$AI_CRYPTOKEN"'
                )
        else:
            return json.loads(path.read_text(encoding="utf-8"))

    # ------------------------------------------------------------------
    # Key rotation
    # ------------------------------------------------------------------

    def _next_key(self, provider: str) -> str:
        keys = [
            k["key"]
            for k in self._config["providers"][provider]["keys"]
            if k.get("type") != "expired"
        ]
        if not keys:
            raise RuntimeError(f"No valid keys for provider {provider!r}")
        idx = self._key_indices.get(provider, 0) % len(keys)
        self._key_indices[provider] = (idx + 1) % len(keys)
        return keys[idx]

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def chat(
        self,
        provider: str,
        model_id: str,
        messages: list[dict],
        use_gateway: bool = False,
    ) -> str:
        """Send chat messages and return the text response.

        Args:
            provider: provider name as in ai.json (e.g. "gemini", "mistral")
            model_id: model identifier (e.g. "gemini-3-flash-preview")
            messages: list of {"role": "system"|"user"|"assistant", "content": str}
            use_gateway: route request via provider gateway settings

        Returns:
            The text content of the model response.
        """
        self._log(
            "chat", provider, model_id,
            "use_gateway=" + str(use_gateway),
            "protocol=" + str(self._config["providers"][provider].get("protocol")),
        )
        pconf = self._config["providers"][provider]
        protocol = pconf["protocol"]

        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES):
            try:
                if use_gateway:
                    return self._chat_gateway(provider, pconf, model_id, messages)
                if protocol == "gemini":
                    return self._chat_gemini(provider, pconf, model_id, messages)
                elif protocol in ("openai", "anthropic"):
                    return self._chat_openai(provider, pconf, model_id, messages)
                else:
                    raise ValueError(f"Unsupported protocol: {protocol!r}")
            except requests.HTTPError as exc:
                status = exc.response.status_code if exc.response is not None else 0
                if self._verbose and exc.response is not None:
                    self._log("HTTPError response status", status)
                    self._log("HTTPError response headers", dict(exc.response.headers))
                    self._log("HTTPError response body", exc.response.text[:2000])
                if status == 429:
                    # Rate limited — rotate key for direct mode, retry as-is for gateway
                    if use_gateway:
                        self._log(f"429 rate limit on {provider} gateway, retrying...")
                    else:
                        self._log(f"429 rate limit on {provider}, rotating key...")
                    time.sleep(2 ** attempt)
                    last_exc = exc
                    continue
                raise
            except Exception as exc:
                last_exc = exc
                if attempt < self.MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise

        assert last_exc is not None
        raise last_exc

    # ------------------------------------------------------------------
    # Protocol implementations
    # ------------------------------------------------------------------

    def _chat_gemini(
        self,
        provider: str,
        pconf: dict,
        model_id: str,
        messages: list[dict],
    ) -> str:
        key = self._next_key(provider)
        url = f"{pconf['endpoint']}/models/{model_id}:generateContent?key={key}"

        system_text: str | None = None
        contents: list[dict] = []

        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "system":
                system_text = content
            else:
                gemini_role = "user" if role == "user" else "model"
                contents.append({"role": gemini_role, "parts": [{"text": content}]})

        body: dict = {"contents": contents}
        if system_text:
            body["system_instruction"] = {"parts": [{"text": system_text}]}

        self._log(
            "POST",
            url,
            self._redact_headers({}),
            "body preview",
            self._preview_payload(body),
        )
        resp = requests.post(url, json=body, timeout=self.DEFAULT_TIMEOUT)
        self._log("Response status", resp.status_code)
        self._log("Response body", resp.text[:2000])
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]

    def _chat_openai(
        self,
        provider: str,
        pconf: dict,
        model_id: str,
        messages: list[dict],
    ) -> str:
        key = self._next_key(provider)
        endpoint = pconf["endpoint"]

        url = f"{endpoint}/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        payload = {"model": model_id, "messages": messages}
        self._log(
            "POST",
            url,
            headers,
            "payload preview",
            self._preview_payload(payload),
        )
        resp = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=self.DEFAULT_TIMEOUT,
        )
        self._log("Response status", resp.status_code)
        self._log("Response body", resp.text[:2000])
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def _chat_gateway(
        self,
        provider: str,
        pconf: dict,
        model_id: str,
        messages: list[dict],
    ) -> str:
        endpoint = pconf.get("gatewayEndpoint")
        model_prefix = pconf.get("gatewayModelPrefix")
        gateway_key = (
            self._gateway_token
            or os.environ.get("AI_GATEWAY_TOKEN")
            or pconf.get("gatewayKey")
        )
        provider_key = self._next_key(provider)

        if not endpoint or model_prefix is None or not gateway_key:
            raise RuntimeError(
                "Gateway mode enabled but provider is missing one of: "
                "gatewayEndpoint, gatewayModelPrefix, gatewayKey"
            )

        url = (
            endpoint
            if endpoint.rstrip("/").endswith("/chat/completions")
            else f"{endpoint.rstrip('/')}/chat/completions"
        )
        gateway_model = (
            f"{model_prefix.rstrip('/')}/{model_id.lstrip('/')}"
            if not model_prefix.endswith("/")
            else f"{model_prefix}{model_id.lstrip('/')}"
        )

        headers = {
            "Authorization": f"Bearer {provider_key}",
            "cf-aig-authorization": f"Bearer {gateway_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": gateway_model, "messages": messages}
        self._log(
            "POST",
            url,
            headers,
            "payload preview",
            self._preview_payload(payload),
        )
        resp = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=self.DEFAULT_TIMEOUT,
        )
        self._log("Response status", resp.status_code)
        self._log("Response body", resp.text[:2000])
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def parse_json_array(response: str) -> list[str]:
        """Extract a JSON array of strings from a model response.

        Handles markdown code fences, leading/trailing prose, and literal
        newlines inside JSON strings (a common model output defect).
        """
        text = response.strip()
        # Strip markdown fences
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

        def _fix_literal_newlines(s: str) -> str:
            """Replace literal newlines inside JSON string values with a space.

            JSON forbids unescaped newlines inside strings. When the model
            wraps a translation across two lines, json.loads() fails. This
            regex replaces bare newlines that are inside a string literal
            (between a non-backslashed quote and the next unescaped quote)
            with a single space.
            """
            # Replace any \n that sits inside a JSON string token.
            # Strategy: find every run of characters between " delimiters
            # that contains a raw newline and collapse it.
            result = []
            in_string = False
            i = 0
            while i < len(s):
                c = s[i]
                if c == '\\' and in_string:
                    # Escaped character — copy two chars as-is
                    result.append(s[i:i+2])
                    i += 2
                    continue
                if c == '"':
                    in_string = not in_string
                    result.append(c)
                elif c == '\n' and in_string:
                    # Literal newline inside a string — replace with space
                    result.append(' ')
                elif c == '\r' and in_string:
                    pass  # discard CR
                else:
                    result.append(c)
                i += 1
            return ''.join(result)

        # Try direct parse
        try:
            result = json.loads(text)
            if isinstance(result, list):
                return [str(x) for x in result]
        except json.JSONDecodeError:
            pass

        # Repair literal newlines inside strings, then retry
        fixed = _fix_literal_newlines(text)
        try:
            result = json.loads(fixed)
            if isinstance(result, list):
                return [str(x) for x in result]
        except json.JSONDecodeError:
            pass

        # Find first JSON array in response and repair
        match = re.search(r"\[.*?\]", fixed, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group(0))
                if isinstance(result, list):
                    return [str(x) for x in result]
            except json.JSONDecodeError:
                pass

        raise ValueError(
            f"Could not parse JSON array from model response:\n{response[:400]}"
        )
