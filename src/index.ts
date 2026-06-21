export { Application, default as express, Express, NextFunction, Request, Response, Router } from 'express'
export { createBridge, onShutdown } from './bridge'
export { config as tbConfig } from './config'
export { createMiddleware } from './middleware'
export type { Middleware } from './middleware'
export { mountMCP } from './mcp'
export { defineBridge, defineEntry, getTools, handleToolCall, isToolMode, TOOL_MODES } from './tools'
export type {
    Bridge,
    BridgeEntries,
    BridgeEntry,
    GetToolsOptions,
    HandleToolCallOptions,
    LLMToolFormat,
    ToolCall,
    ToolMode,
    ToolSurface
} from './tools'
export { z } from 'zod'
