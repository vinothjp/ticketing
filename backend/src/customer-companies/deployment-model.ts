/**
 * How a client runs a product — offered for SAP S/4HANA on the client product
 * screen. Mirrored in frontend `components/DeploymentModelChoice.tsx`.
 */
export const DEPLOYMENT_MODELS = ['PRIVATE_CLOUD', 'PUBLIC_CLOUD', 'ON_PREMISES'] as const;
export type DeploymentModel = (typeof DEPLOYMENT_MODELS)[number];
