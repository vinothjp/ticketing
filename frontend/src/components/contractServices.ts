/** What else a contract covers, beside its support hours. Shared by the client
 *  contract screen and the per-product terms screen; saved with the terms. */
export interface ContractServicesValue {
  thirdPartyIntegration: boolean;
  planRollout: boolean;
  crApplicable: boolean;
  /** '' = no limit set. Only meaningful with crApplicable on. */
  crMaxPerMonth: number | '';
  /** A CR estimated above this many hours is chargeable. */
  crMaxHours: number | '';
}

/** The server's `services` block → the form's shape. */
export const servicesForm = (s?: {
  thirdPartyIntegration: boolean; planRollout: boolean; crApplicable: boolean;
  crMaxPerMonth: number | null; crMaxHours: number | null;
} | null): ContractServicesValue => ({
  thirdPartyIntegration: s?.thirdPartyIntegration ?? false,
  planRollout: s?.planRollout ?? false,
  crApplicable: s?.crApplicable ?? false,
  crMaxPerMonth: s?.crMaxPerMonth ?? '',
  crMaxHours: s?.crMaxHours ?? '',
});

/** The form → the API payload. A blank box is sent as null, which clears it. */
export const servicesPayload = (v: ContractServicesValue) => ({
  thirdPartyIntegration: v.thirdPartyIntegration,
  planRollout: v.planRollout,
  crApplicable: v.crApplicable,
  crMaxPerMonth: v.crApplicable && v.crMaxPerMonth !== '' ? Number(v.crMaxPerMonth) : null,
  crMaxHours: v.crApplicable && v.crMaxHours !== '' ? Number(v.crMaxHours) : null,
});
