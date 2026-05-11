#!/usr/bin/env bash
# Example: call the AI proxy with an AGE private key as bearer token.
# Replace AGE-SECRET-KEY-... with a real key from keys/private/userXXX.key
# Set AI_PROXY_URL in your .env or replace below.

curl "${AI_PROXY_URL:-https://your-ai-proxy.example.com/groq/v1/chat/completions}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AGE-SECRET-KEY-REPLACE_WITH_YOUR_KEY" \
  -H "X-Host-Final: api.groq.com" \
  -d '{
    "messages": [
      {
        "role": "system",
        "content": "You are a senior developer. Translate source code comments to English without altering the code. Return ONLY the resulting source code with no decoration."
      },
      {
        "role": "user",
        "content": "/* Replace with your source code */"
      }
    ],
    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
    "temperature": 1,
    "max_completion_tokens": 8192,
    "top_p": 1,
    "stream": true,
    "stop": null
  }'
