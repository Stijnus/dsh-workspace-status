/**
 * Host half of workspace-status.
 *
 * The Client module owns the indicator: it reads Workspace and Session state
 * through the slot's standard hooks and publishes the row rules from its own
 * component, so the Host has no service to provide and no resource to register.
 * This empty `apply` exists only to give the Loader a host-side row, exactly
 * like any other bundle that is purely a browser feature.
 */

/** Loader entry name; matches the patch row in `cordis.patch.yml`. */
export const name = 'workspace-status'

/** No Host services are required. */
export const inject = []

/** No Host-side behavior. */
export function apply() {}
