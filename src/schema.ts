export const typeDefs = /* GraphQL */ `
  type Adviser {
    id: ID!
    name: String!
    firm: String!
  }

  type Client {
    id: ID!
    firstName: String!
    lastName: String!
    "Resolved from AdviserService. Null if the adviser cannot be retrieved."
    adviser: Adviser
  }

  type Query {
    clientProfile(clientId: ID!): Client
    "List lookup — the shape that exposes N+1 if Client.adviser is resolved naively."
    clients(clientIds: [ID!]!): [Client]!
  }
`;
