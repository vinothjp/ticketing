import { planDelivery } from './ticket-notify';

const agent = { id: 'agent-1', email: 'a1@provider.test' };
const client = { id: 'contact-1', email: 'ada@acme.test' };

describe('planDelivery — the Email Configuration rows, per person', () => {
  it('bells everyone in a row with Bell ticked except the helpdesk, which still gets the email', () => {
    const { deliveries, helpdesk } = planDelivery(
      [{ recipients: ['REQUESTOR', 'HELPDESK_EMAIL', 'ASSIGNED_AGENT'], email: true, bell: true }],
      { REQUESTOR: [client], ASSIGNED_AGENT: [agent] },
    );
    expect(helpdesk).toBe(true);
    expect(deliveries.map((d) => [d.person.id, d.email, d.bell])).toEqual([
      ['contact-1', true, true],
      ['agent-1', true, true],
    ]);
  });

  it('unions an event\'s rows, so one row can bell and another email the same person', () => {
    const { deliveries } = planDelivery(
      [
        { recipients: ['ASSIGNED_AGENT'], email: true, bell: false },
        { recipients: ['TENANT_ADMINS'], email: false, bell: true },
      ],
      { ASSIGNED_AGENT: [agent], TENANT_ADMINS: [agent] },
    );
    expect(deliveries).toHaveLength(1);
    // Told once, in the agent's wording rather than the admins'.
    expect(deliveries[0]).toEqual(expect.objectContaining({ role: 'ASSIGNED_AGENT', email: true, bell: true }));
  });

  it('never bells an address with no user behind it', () => {
    const { deliveries } = planDelivery(
      [{ recipients: ['REQUESTOR'], email: true, bell: true }],
      { REQUESTOR: [{ id: null, email: 'someone@acme.test' }] },
    );
    expect(deliveries[0]).toEqual(expect.objectContaining({ email: true, bell: false }));
  });

  it('puts client sends first and drops whoever is skipped', () => {
    const { deliveries, helpdesk } = planDelivery(
      [{ recipients: ['TENANT_ADMINS', 'REQUESTOR'], email: true, bell: false }],
      { TENANT_ADMINS: [{ id: 'admin-1', email: 'x@p.test' }, { id: 'admin-2', email: 'y@p.test' }], REQUESTOR: [client] },
      (p) => p.id === 'admin-1',
    );
    expect(helpdesk).toBe(false);
    expect(deliveries.map((d) => d.person.id)).toEqual(['contact-1', 'admin-2']);
  });
});
