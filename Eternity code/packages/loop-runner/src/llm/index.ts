import Anthropic from '@anthropic-ai/sdk'

export interface LLMClient {
  generateText(prompt: string, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<string>
  
  generateJSON<T>(prompt: string, schema: any, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<T>
}

export interface LLMConfig {
  provider: 'anthropic' | 'glm' | 'openai'
  apiKey: string
  model?: string
  baseUrl?: string
}

export function createLLMClient(config: LLMConfig): LLMClient {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicClient(config)
    case 'glm':
      return new GLMClient(config)
    case 'openai':
      return new OpenAIClient(config)
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`)
  }
}

class AnthropicClient implements LLMClient {
  private client: Anthropic
  private defaultModel: string
  
  constructor(private config: LLMConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    })
    this.defaultModel = config.model || 'claude-3-sonnet-20240229'
  }
  
  async generateText(prompt: string, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<string> {
    const response = await this.client.messages.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 1024,
      temperature: options?.temperature || 0.7,
      messages: [{ role: 'user', content: prompt }]
    })
    
    return response.content[0].text
  }
  
  async generateJSON<T>(prompt: string, schema: any, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<T> {
    const jsonPrompt = `${prompt}\n\nRespond with valid JSON only.`
    const text = await this.generateText(jsonPrompt, options)
    
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error(`Failed to parse JSON response: ${error}`)
    }
  }
}

class GLMClient implements LLMClient {
  constructor(private config: LLMConfig) {}
  
  async generateText(prompt: string, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<string> {
    // GLM API implementation
    // This would make HTTP requests to GLM API
    const url = this.config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: options?.model || this.config.model || 'glm-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options?.maxTokens || 1024,
        temperature: options?.temperature || 0.7
      })
    })
    
    const data = await response.json() as any
    return data.choices[0].message.content
  }
  
  async generateJSON<T>(prompt: string, schema: any, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<T> {
    const jsonPrompt = `${prompt}\n\nRespond with valid JSON only.`
    const text = await this.generateText(jsonPrompt, options)
    
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error(`Failed to parse JSON response: ${error}`)
    }
  }
}

class OpenAIClient implements LLMClient {
  constructor(private config: LLMConfig) {}
  
  async generateText(prompt: string, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<string> {
    // OpenAI API implementation
    const url = this.config.baseUrl || 'https://api.openai.com/v1/chat/completions'
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: options?.model || this.config.model || 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options?.maxTokens || 1024,
        temperature: options?.temperature || 0.7
      })
    })
    
    const data = await response.json() as any
    return data.choices[0].message.content
  }
  
  async generateJSON<T>(prompt: string, schema: any, options?: {
    model?: string
    maxTokens?: number
    temperature?: number
  }): Promise<T> {
    const jsonPrompt = `${prompt}\n\nRespond with valid JSON only.`
    const text = await this.generateText(jsonPrompt, options)
    
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error(`Failed to parse JSON response: ${error}`)
    }
  }
}
