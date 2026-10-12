import { ApolloServer } from '@apollo/server';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { formatError } from './errors';
import { createLoaders } from './loaders';
import type { GraphQLContext } from './types';

export function createServer(): ApolloServer<GraphQLContext> {
  return new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    formatError,
    includeStacktraceInErrorResponses: false,
    introspection: process.env['NODE_ENV'] === 'development',
  });
}

/** Fresh loaders every request — caches must never span users. */
export function createContext(): GraphQLContext {
  return { loaders: createLoaders() };
}
