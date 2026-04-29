# Server Chat - Example Configuration

This file shows example configurations for various AI providers.

## OpenAI

```json
{
  "name": "OpenAI",
  "endpoint": "https://api.openai.com/v1",
  "model": "gpt-4"
}
```

## Azure OpenAI

```json
{
  "name": "Azure OpenAI",
  "endpoint": "https://your-resource.openai.azure.com/openai/deployments/your-deployment",
  "model": "gpt-4"
}
```

Note: Azure requires adding `?api-version=2024-02-15-preview` to the endpoint.

## DeepSeek

```json
{
  "name": "DeepSeek",
  "endpoint": "https://api.deepseek.com/v1",
  "model": "deepseek-chat"
}
```

## Local LLM (Ollama)

```json
{
  "name": "Ollama Local",
  "endpoint": "http://localhost:11434/v1",
  "model": "llama3"
}
```

## Anthropic Claude (via proxy)

If you have a proxy service that converts Anthropic API to OpenAI format:

```json
{
  "name": "Claude",
  "endpoint": "https://your-proxy.com/v1",
  "model": "claude-3-opus"
}
```

---

## Adding Configuration in App

1. Click the ⚙️ icon in the top-right corner
2. Click "+ 新增配置" (Add Config)
3. Fill in the fields:
   - **Name**: Display name for this config
   - **Endpoint**: API endpoint URL
   - **API Key**: Your API key (stored securely)
   - **Model**: Model name to use
4. Click "保存" (Save)

## Switching Configurations

- Click on any config card to activate it
- Active config shows a green "当前" (Current) badge