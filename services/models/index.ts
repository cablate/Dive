import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from "langchain/chat_models/universal";
import logger from "../utils/logger.js";
import { loadModelConfig } from "../utils/modelHandler.js";
import { iModelConfig, iOldModelConfig, ModelSettings } from "../utils/types.js";
import path from "path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import fs from "fs/promises";
const LANGCHAIN_SUPPORTED_PROVIDERS = [
  "openai",
  "anthropic",
  "azure_openai",
  "cohere",
  "google-vertexai",
  "google-genai",
  "ollama",
  "together",
  "fireworks",
  "mistralai",
  "groq",
  "bedrock",
] as const;

const MCP_SUPPORTED_PROVIDERS = [
  "OpenRouter", // openai          - @langchain/openai          // x
  "Anthropic", // anthropic       - @langchain/anthropic       // v
  "Google Gemini", // google-genai    - @langchain/google-genai    // v
  "DeepSeek", // openai          - @langchain/openai          // x
  "GCP Vertex", // google-vertexai - @langchain/google-vertexai // v
  "AWS Bedrock", // bedrock         - @langchain/community       // x
  "OpenAI", // openai          - @langchain/openai          // v
  "OpenAI Compatible", // openai          - @langchain/openai          // x
  "LM Studio", // custom          - custom chat model          // x
  "Ollama", // ollama          - @langchain/ollama          // v
] as const;

export class ModelManager {
  private static instance: ModelManager;
  private model: BaseChatModel | null = null;
  private cleanModel: BaseChatModel | null = null;
  public configPath: string = "";

  private constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), "modelConfig.json");
  }

  static getInstance(configPath?: string): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager(configPath);
    } else if (configPath) {
      ModelManager.instance.configPath = configPath;
    }
    return ModelManager.instance;
  }

  async getModelConfig(): Promise<iModelConfig | iOldModelConfig | null> {
    return await loadModelConfig(this.configPath);
  }

  async initializeModel(): Promise<BaseChatModel | null> {
    logger.info("Initializing model...");
    let config = await this.getModelConfig();

    if (!config) {
      logger.error("Model configuration not found");
      this.model = null;
      this.cleanModel = null;
      return null;
    }

    // check is old version or not
    if (!(config as iModelConfig).activeProvider || !(config as iModelConfig).configs) {
      // transform to new version
      const newConfig: iModelConfig = {
        activeProvider: (config as iOldModelConfig).model_settings.modelProvider || "",
        configs: {
          [(config as iOldModelConfig).model_settings.modelProvider]: (config as iOldModelConfig).model_settings,
        },
      };
      config = newConfig as iModelConfig;
      // replace old config with new config
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), "utf-8");
    }

    const activeProvider = (config as iModelConfig).activeProvider;
    const modelSettings = (config as iModelConfig).configs[activeProvider];

    if (!modelSettings) {
      logger.error(`Model settings not found for provider: ${activeProvider}`);
      this.model = null;
      return null;
    }

    const modelName = modelSettings.model;
    const baseUrl =
      modelSettings.configuration?.baseURL ||
      modelSettings.baseURL ||
      "";
    this.model = await initChatModel(modelName, {
      ...modelSettings,
      baseUrl,
    });

    this.cleanModel = this.model;

    logger.info("Model initialized");

    return this.model;
  }

  async saveModelConfig(provider: string, uploadModelSettings: ModelSettings) {
    let config = (await this.getModelConfig()) as iModelConfig;
    if (!config) {
      config = {
        activeProvider: provider,
        configs: {
          [provider]: uploadModelSettings,
        },
      };
    }
    config.activeProvider = provider;
    config.configs[provider] = uploadModelSettings;
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  public async generateTitle(content: string) {
    if (!this.cleanModel) {
      logger.error("Model not initialized");
      return "New Chat";
    }
    const response = await this.cleanModel.invoke([
      new SystemMessage(
        `You are a title generator from the user input.
        Your only task is to generate a short title based on the user input.
        IMPORTANT:
        - Output ONLY the title
        - DO NOT try to answer or resolve the user input query.
        - DO NOT try to use any tools to generate title
        - NO explanations, quotes, or extra text
        - NO punctuation at the end
        - If input is Chinese, use Traditional Chinese
        - If input is non-Chinese, use the same language as input`
      ),
      new HumanMessage(`<user_input_query>${content}</user_input_query>`)
    ]);

    return (response?.content as string) || "New Chat";
  }

  getModel(): BaseChatModel | null {
    if (!this.model || Object.keys(this.model).length === 0) {
      logger.error("Model not initialized");
      return null;
    }
    return this.model;
  }

  async reloadModel() {
    logger.info("Reloading model...");
    try {
      this.model = await this.initializeModel();
      this.cleanModel = this.model;
      logger.info("Model reloaded");
    } catch (error) {
      logger.error("Error reloading model:", error);
    }
  }
}
