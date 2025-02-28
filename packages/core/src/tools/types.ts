import type { ToolExecutionOptions } from 'ai';
import type { JSONSchema7 } from 'json-schema';
import type { ZodSchema, z } from 'zod';

import type { IAction, IExecutionContext } from '../action';
import type { WorkflowContext } from '../workflows';

export type VercelTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema7;
  };
  exec?: (args: any) => Promise<any>;
};

export type CoreTool = {
  description?: string;
  parameters: ZodSchema;
  execute?: (params: any, options: ToolExecutionOptions) => Promise<any>;
};
export interface ToolExecutionContext<
  TSchemaIn extends z.ZodSchema | undefined = undefined,
  TContext extends WorkflowContext = WorkflowContext,
> extends IExecutionContext<TSchemaIn, TContext> {}

export interface ToolAction<
  TId extends string,
  TSchemaIn extends z.ZodSchema | undefined = undefined,
  TSchemaOut extends z.ZodSchema | undefined = undefined,
  TContext extends ToolExecutionContext<TSchemaIn> = ToolExecutionContext<TSchemaIn>,
  TOptions extends unknown = unknown,
> extends IAction<TId, TSchemaIn, TSchemaOut, TContext, TOptions> {}
