-- Lists retired from the Option List registry.
--
-- Round 1 — nothing read them:
--   CHANGE_CUSTOMER  - a CR's customer is a real CustomerCompany;
--                      ChangeRequest.customer is denormalised from it.
--   RESOLUTION_CODE  - Ticket.resolutionCode has no DTO, no writer and no UI.
--
-- Round 2 — they named records another screen already owns, so a value added
-- here could never become the template/project/module/user it named. Those
-- fields read the real records instead (EntitySelect in the CR module):
--   TEMPLATE_CATEGORY, CHANGE_PROJECT, CHANGE_MODULE, CHANGE_PERSON.
--
-- Only the registry rows go; their values stay in place, so re-registering a
-- list later brings them straight back. Idempotent.

DELETE FROM "OptionList"
 WHERE "isSystem" = true
   AND "code" IN (
     'CHANGE_CUSTOMER', 'RESOLUTION_CODE',
     'TEMPLATE_CATEGORY', 'CHANGE_PROJECT', 'CHANGE_MODULE', 'CHANGE_PERSON'
   );

-- The template categories seeded for the retired TEMPLATE_CATEGORY list: they
-- were never anything but a copy of the Templates screen's own constant, and no
-- record stores a reference to them (Template.category holds the plain string).
DELETE FROM "PicklistOption" WHERE "listKey" = 'templateCategory';
