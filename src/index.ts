import { startStandaloneServer } from '@apollo/server/standalone';
import { createContext, createServer } from './server';

async function main(): Promise<void> {
  const server = createServer();
  const { url } = await startStandaloneServer(server, {
    listen: { port: Number(process.env['PORT'] ?? 4000) },
    context: async () => createContext(),
  });
  console.log(`GraphQL gateway ready at ${url}`);
}

void main();
