import assert from 'node:assert';
import type { ApolloServer } from '@apollo/server';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { createContext, createServer } from '../src/server';
import { AdviserService } from '../src/services/adviserService';
import { ClientService } from '../src/services/clientService';
import type { GraphQLContext } from '../src/types';

type ExecResult = { data?: Record<string, unknown> | null; errors?: ReadonlyArray<GraphQLFormattedError> };

let server: ApolloServer<GraphQLContext>;

async function run(query: string, variables: Record<string, unknown> = {}): Promise<ExecResult> {
  const res = await server.executeOperation({ query, variables }, { contextValue: createContext() });
  assert(res.body.kind === 'single');
  return res.body.singleResult as ExecResult;
}

beforeAll(() => {
  server = createServer();
});
afterEach(() => jest.restoreAllMocks());

describe('Test 1 — Efficiency: lazy adviser resolution', () => {
  it('never calls AdviserService when the adviser field is not selected', async () => {
    const spy = jest.spyOn(AdviserService, 'getDetails');

    const result = await run(
      `query ($id: ID!) { clientProfile(clientId: $id) { id firstName lastName } }`,
      { id: 'C-001' },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ clientProfile: { id: 'C-001', firstName: 'Amelia', lastName: 'Hart' } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('does call it exactly once when the adviser field is selected (control case)', async () => {
    const spy = jest.spyOn(AdviserService, 'getDetails');
    const result = await run(`{ clientProfile(clientId: "C-001") { id adviser { name firm } } }`);

    expect(result.data).toEqual({
      clientProfile: { id: 'C-001', adviser: { name: 'Sarah Whitfield', firm: 'Northbank Wealth' } },
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('Test 2 — Batching: DataLoader removes N+1', () => {
  it('makes a single AdviserService call for many clients sharing one adviser', async () => {
    const spy = jest.spyOn(AdviserService, 'getDetails');

    const result = await run(
      `query ($ids: [ID!]!) { clients(clientIds: $ids) { id adviser { id name } } }`,
      { ids: ['C-001', 'C-002', 'C-003'] }, // all linked to ADV-01
    );

    expect(result.errors).toBeUndefined();
    const clients = (result.data as { clients: Array<{ adviser: { id: string } }> }).clients;
    expect(clients).toHaveLength(3);
    clients.forEach((c) => expect(c.adviser.id).toBe('ADV-01'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('ADV-01');
  });

  it('makes one call per unique adviser, not per client', async () => {
    const spy = jest.spyOn(AdviserService, 'getDetails');
    await run(`{ clients(clientIds: ["C-001","C-002","C-003","C-004"]) { id adviser { id } } }`);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map(([id]) => id).sort()).toEqual(['ADV-01', 'ADV-02']);
  });

  it('does not share the loader cache across requests', async () => {
    const spy = jest.spyOn(AdviserService, 'getDetails');
    await run(`{ clientProfile(clientId: "C-001") { adviser { id } } }`);
    await run(`{ clientProfile(clientId: "C-002") { adviser { id } } }`);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('Test 3 — Graceful failure: revoked adviser, zero-trust errors', () => {
  const PII_AND_INTERNALS = [
    'Grace', 'Lowell', // client PII
    'ADV-99', // internal reference to another record
    'adviser-svc', '.internal', '8443', 'http', '403', 'Forbidden', 'revoked', // topology / downstream details
    'DownstreamServiceError', 'stacktrace', 'at ', // stack/implementation details
  ];

  it('returns client data with adviser: null and a sanitised error', async () => {
    const result = await run(
      `{ clientProfile(clientId: "A-000") { id firstName lastName adviser { id name firm } } }`,
    );

    // Partial data still returned
    expect(result.data).toEqual({
      clientProfile: { id: 'A-000', firstName: 'Grace', lastName: 'Lowell', adviser: null },
    });

    // Exactly one, generic, coded error pointing at the failed field
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors!;
    expect(error).toEqual({
      message: 'Adviser details are currently unavailable.',
      path: ['clientProfile', 'adviser'],
      locations: expect.any(Array),
      extensions: { code: 'ADVISER_UNAVAILABLE' },
    });

    // Nothing sensitive anywhere in the errors payload
    const serialised = JSON.stringify(result.errors);
    PII_AND_INTERNALS.forEach((needle) => expect(serialised).not.toContain(needle));
  });

  it('isolates the failure: other clients in the same batch still get their adviser', async () => {
    const result = await run(`{ clients(clientIds: ["C-001","A-000"]) { id adviser { id } } }`);

    expect(result.data).toEqual({
      clients: [
        { id: 'C-001', adviser: { id: 'ADV-01' } },
        { id: 'A-000', adviser: null },
      ],
    });
    expect(result.errors).toHaveLength(1);
  });

  it('masks unexpected errors with a generic INTERNAL_SERVER_ERROR', async () => {
    jest
      .spyOn(require('../src/services/clientService').ClientService, 'getDetails')
      .mockRejectedValue(new Error('ECONNREFUSED 10.0.3.17:5432 client-db password auth failed for user "svc_client"'));

    const result = await run(`{ clientProfile(clientId: "C-001") { id } }`);

    expect(result.errors).toEqual([
      {
        message: 'An unexpected error occurred.',
        path: ['clientProfile'],
        locations: expect.any(Array),
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|10\.0\.3\.17|svc_client|stacktrace/);
  });

  it('masks a downstream error even when it carries an allow-listed code', async () => {
    // formatError trusts the code, so the resolver must not let a service's own GraphQLError through.
    jest.spyOn(ClientService, 'getDetails').mockRejectedValue(
      new GraphQLError('upstream client-svc.internal:9000 rejected token for Amelia Hart', {
        extensions: { code: 'BAD_USER_INPUT' },
      }),
    );

    const result = await run(`{ clientProfile(clientId: "C-001") { id } }`);

    expect(result.data).toEqual({ clientProfile: null });
    expect(result.errors).toEqual([
      {
        message: 'An unexpected error occurred.',
        path: ['clientProfile'],
        locations: expect.any(Array),
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/client-svc|9000|rejected token|Amelia|Hart/);
  });

  it('isolates a failed client lookup: the rest of the list still returns', async () => {
    const original = ClientService.getDetails.bind(ClientService);
    jest.spyOn(ClientService, 'getDetails').mockImplementation(async (id: string) => {
      if (id === 'C-002') throw new Error('ECONNREFUSED 10.0.3.17:5432 client-db');
      return original(id);
    });

    const result = await run(`{ clients(clientIds: ["C-001","C-002","C-004"]) { id adviser { id } } }`);

    expect(result.data).toEqual({
      clients: [{ id: 'C-001', adviser: { id: 'ADV-01' } }, null, { id: 'C-004', adviser: { id: 'ADV-02' } }],
    });
    expect(result.errors).toEqual([
      {
        message: 'An unexpected error occurred.',
        path: ['clients', 1],
        locations: expect.any(Array),
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|10\.0\.3\.17|client-db/);
  });

  it('rejects malformed client IDs before reaching any service', async () => {
    const spy = jest.spyOn(require('../src/services/clientService').ClientService, 'getDetails');
    const result = await run(`{ clientProfile(clientId: "1 OR 1=1") { id } }`);

    expect(result.errors?.[0]?.extensions).toEqual({ code: 'BAD_USER_INPUT' });
    expect(spy).not.toHaveBeenCalled();
  });
});
