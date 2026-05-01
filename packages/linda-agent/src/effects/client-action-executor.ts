import type { ClinicBackendClient, RequestOptions } from "../core/backend-client.js";
import type { ActionExecution, ProposedAction } from "../core/control-types.js";

type ClientActionHandler = (input: {
	backend: ClinicBackendClient;
	clientId: string;
	action: ActionExecution;
	options: RequestOptions;
}) => Promise<void>;

const CLIENT_ACTION_HANDLERS: Record<string, ClientActionHandler> = {
	update_lead_fields: async ({ backend, clientId, action, options }) => {
		await backend.patchClientProfile(clientId, action.payload, options);
	},
};

export function canExecuteApprovedClientActions(input: {
	proposedActions: ProposedAction[];
	executableActions: ActionExecution[];
}) {
	return input.proposedActions.every((proposedAction) => {
		if (!CLIENT_ACTION_HANDLERS[proposedAction.actionId]) {
			return false;
		}
		return input.executableActions.some((executableAction) => executableAction.actionId === proposedAction.actionId);
	});
}

export async function executeApprovedClientActions(input: {
	backend: ClinicBackendClient;
	clientId: string;
	actions: ActionExecution[];
	options: RequestOptions;
}) {
	for (const action of input.actions) {
		const handler = CLIENT_ACTION_HANDLERS[action.actionId];
		if (!handler) {
			throw new Error(`unsupported_client_action:${action.actionId}`);
		}
		await handler({
			backend: input.backend,
			clientId: input.clientId,
			action,
			options: input.options,
		});
	}
}
