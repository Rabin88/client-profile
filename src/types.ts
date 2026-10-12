import type DataLoader from 'dataloader';
import type { GraphQLFieldResolver } from 'graphql';

export interface ClientRecord {
  id: string;
  firstName: string;
  lastName: string;
  adviserId: string;
}

export interface AdviserRecord {
  id: string;
  name: string;
  firm: string;
}

export interface Loaders {
  adviser: DataLoader<string, AdviserRecord>;
}

export interface GraphQLContext {
  loaders: Loaders;
}

export interface ClientProfileArgs {
  clientId: string;
}

export interface ClientsArgs {
  clientIds: string[];
}

/** Resolver map typed against the schema's shapes and the shared context. */
export type Resolvers = {
  Query: {
    clientProfile: GraphQLFieldResolver<unknown, GraphQLContext, ClientProfileArgs, Promise<ClientRecord | null>>;
    /** An Error entry makes graphql-js null that list item and report a per-item error. */
    clients: GraphQLFieldResolver<unknown, GraphQLContext, ClientsArgs, Promise<Array<ClientRecord | Error | null>>>;
  };
  Client: {
    adviser: GraphQLFieldResolver<ClientRecord, GraphQLContext, Record<string, never>, Promise<AdviserRecord>>;
  };
};
