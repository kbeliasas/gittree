import type { FastifySchemaCompiler, FastifySerializerCompiler, FastifyTypeProvider } from 'fastify';
import { z } from 'zod';

/**
 * Lets Fastify routes use zod schemas from src/shared directly: request parts
 * are parsed (and typed) by them, responses are checked against them before
 * they are sent.
 */
export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends z.ZodType ? z.output<this['schema']> : unknown;
  serializer: this['schema'] extends z.ZodType ? z.input<this['schema']> : unknown;
}

export const validatorCompiler: FastifySchemaCompiler<z.ZodType> =
  ({ schema }) =>
  (data) => {
    const result = schema.safeParse(data);
    return result.success ? { value: result.data } : { error: new Error(z.prettifyError(result.error)) };
  };

export const serializerCompiler: FastifySerializerCompiler<z.ZodType> =
  ({ schema }) =>
  (data) =>
    JSON.stringify(schema.parse(data));
