import { ClientService } from "./services/clientService";
import {
  AdviserService,
  DownstreamServiceError
} from "./services/adviserService";
import { ErrorCode, safeError } from "./errors";
import { logger } from "./logger";
import type { Resolvers } from "./types";

const CLIENT_ID_PATTERN = /^[A-Z]-\d{3}$/;
const MAX_CLIENTS_PER_QUERY = 50;

function assertValidClientId(id: string): void {
  if (!CLIENT_ID_PATTERN.test(id)) {
    throw safeError("Invalid client ID format.", ErrorCode.BAD_USER_INPUT);
  }
}

export const resolvers: Resolvers = {
  Query: {
    clientProfile: async (_parent, args) => {
      assertValidClientId(args.clientId);
      // Catch here rather than rely on formatError alone: it trusts the error's code,
      // so a downstream error carrying an allow-listed code would keep its message.
      try {
        return await ClientService.getDetails(args.clientId);
      } catch {
        logger.warn("clientProfile_lookup_failed", { clientId: args.clientId });
        throw safeError(
          "An unexpected error occurred.",
          ErrorCode.INTERNAL_SERVER_ERROR
        );
      }
    },

    clients: async (_parent, args) => {
      if (args.clientIds.length > MAX_CLIENTS_PER_QUERY) {
        throw safeError(
          `A maximum of ${MAX_CLIENTS_PER_QUERY} clients can be requested.`,
          ErrorCode.BAD_USER_INPUT
        );
      }
      args.clientIds.forEach(assertValidClientId);
      // allSettled so one failed lookup nulls only that entry, not the whole list.
      const settled = await Promise.allSettled(
        args.clientIds.map((id) => ClientService.getDetails(id))
      );
      return settled.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        logger.warn("client_lookup_failed", {
          clientId: args.clientIds[i] ?? "unknown"
        });
        return safeError(
          "An unexpected error occurred.",
          ErrorCode.INTERNAL_SERVER_ERROR
        );
      });
    }
  },

  Client: {
    /**
     * Field-level resolver: only runs if `adviser` is selected.
     * Goes through the per-request DataLoader so N clients -> 1 batched lookup
     * per unique adviser (fixes N+1). On failure, the field becomes null and a
     * generic coded error is returned — the raw downstream error stays server-side.
     */
    adviser: async (client, _args, ctx) => {
      try {
        // with dataloader
        return await ctx.loaders.adviser.load(client.adviserId);
        // without dataloader - (naive: one service call per client)
        // return await AdviserService.getDetails(client.adviserId);
      } catch (err: unknown) {
        logger.warn("adviser_lookup_failed", {
          clientId: client.id,
          adviserId: client.adviserId,
          status: err instanceof DownstreamServiceError ? err.status : "unknown"
        });
        throw safeError(
          "Adviser details are currently unavailable.",
          ErrorCode.ADVISER_UNAVAILABLE
        );
      }
    }
  }
};
