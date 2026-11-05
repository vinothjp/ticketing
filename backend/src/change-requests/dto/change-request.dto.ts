import {
  IsString, IsOptional, IsNotEmpty, IsDateString, IsBoolean, IsIn, IsInt, IsNumber, IsObject,
} from 'class-validator';

// All categorical fields are free strings here — their allowed values are
// constrained by the CR option store on the client, so admins can extend the
// lists without a code change. Only `title` is mandatory.

export class CreateChangeRequestDto {
  @IsString() @IsNotEmpty() title!: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() featureName?: string;

  // Customer company this CR belongs to — its admin approves the CR.
  @IsOptional() @IsString() customerCompanyId?: string;

  // Whether the change is raised for a customer or is one of our own. INTERNAL
  // clears the customer link entirely (see ChangeRequestsService).
  @IsOptional() @IsIn(['CUSTOMER', 'INTERNAL']) changeSource?: string;

  // Dropdown values (from the CR option store)
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() projectName?: string;
  @IsOptional() @IsString() moduleName?: string;
  @IsOptional() @IsString() crType?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() crCategory?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() requestedBy?: string;
  @IsOptional() @IsString() businessOwner?: string;
  @IsOptional() @IsString() functionalConsultant?: string;
  @IsOptional() @IsString() technicalConsultant?: string;
  @IsOptional() @IsString() projectManager?: string;

  // Change Management (ITIL) — General section
  @IsOptional() @IsString() changeType?: string;
  @IsOptional() @IsString() changeGroup?: string;
  @IsOptional() @IsString() changeOwner?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() impact?: string;
  @IsOptional() @IsString() servicesAffected?: string;
  @IsOptional() @IsString() comments?: string;
  // Roles
  @IsOptional() @IsString() changeCoordinator?: string;
  @IsOptional() @IsString() implementor?: string;
  @IsOptional() @IsString() lineManager?: string;
  @IsOptional() @IsString() reviewer?: string;
  @IsOptional() @IsString() changeApprover?: string;
  @IsOptional() @IsString() changeApproverUserId?: string;

  // Dates
  @IsOptional() @IsDateString() crDate?: string;
  @IsOptional() @IsDateString() crStartDate?: string;
  @IsOptional() @IsDateString() crEndDate?: string;
  @IsOptional() @IsDateString() targetReleaseDate?: string;
  @IsOptional() @IsDateString() expectedGoLiveDate?: string;

  // Business Requirement (Phase 2)
  @IsOptional() @IsString() requirementDetails?: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsString() reasonForCr?: string;
  @IsOptional() @IsString() benefitToCustomer?: string;

  // Blue Print (Phase 3)
  @IsOptional() @IsString() blueprintName?: string;
  @IsOptional() @IsString() blueprintVersionNumber?: string;
  @IsOptional() @IsString() blueprintPreparedBy?: string;
  @IsOptional() @IsString() blueprintReviewedBy?: string;
  @IsOptional() @IsString() blueprintApprovedBy?: string;
  @IsOptional() @IsDateString() blueprintApprovalDate?: string;
  @IsOptional() @IsString() blueprintRemarks?: string;

  // Impact Analysis (Phase 5)
  @IsOptional() @IsString() affectedModule?: string;
  @IsOptional() @IsString() affectedTables?: string;
  @IsOptional() @IsString() impactReports?: string;
  @IsOptional() @IsString() impactInterfaces?: string;
  @IsOptional() @IsString() impactForms?: string;
  @IsOptional() @IsString() impactWorkflow?: string;
  @IsOptional() @IsString() masterData?: string;
  @IsOptional() @IsString() authorizations?: string;
  @IsOptional() @IsString() performance?: string;
  @IsOptional() @IsString() risk?: string;
  @IsOptional() @IsNumber() estimatedHours?: number;
  @IsOptional() @IsString() complexity?: string;

  // Development Details (Phase 6)
  @IsOptional() @IsString() developer?: string;
  @IsOptional() @IsString() developmentStatus?: string;
  @IsOptional() @IsDateString() developmentStartDate?: string;
  @IsOptional() @IsDateString() completionDate?: string;
  @IsOptional() @IsString() transportNumber?: string;
  @IsOptional() @IsString() gitRepository?: string;
  @IsOptional() @IsString() buildNumber?: string;

  // Testing (Phase 7)
  @IsOptional() @IsString() testCase?: string;
  @IsOptional() @IsString() testingPerson?: string;
  @IsOptional() @IsString() testingStatus?: string;
  @IsOptional() @IsString() uatPerformedBy?: string;
  @IsOptional() @IsInt() defectCount?: number;
  @IsOptional() @IsString() retest?: string;
  @IsOptional() @IsString() testApproval?: string;

  // Deployment (Phase 8)
  @IsOptional() @IsString() deploymentPlan?: string;
  @IsOptional() @IsString() goLiveChecklist?: string;
  @IsOptional() @IsString() rollbackPlan?: string;
  @IsOptional() @IsString() transportList?: string;
  @IsOptional() @IsDateString() deploymentDate?: string;
  @IsOptional() @IsString() supportWindow?: string;
}

export class CrRejectDto {
  @IsString() @IsNotEmpty() reason!: string;
}

// Move a CR to the next stage. Server enforces "next only" (no skipping).
export class AdvanceStageDto {
  @IsString() @IsNotEmpty() targetStage!: string;
}

// CAB (Change Approval Board) sign-off decision on a CR.
export class CabDecisionDto {
  @IsString() @IsNotEmpty() decision!: string; // 'APPROVED' | 'REJECTED'
  @IsOptional() @IsString() reason?: string;
}

export class UpdateChangeRequestDto {
  @IsOptional() @IsString() customerCompanyId?: string;
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() featureName?: string;

  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() projectName?: string;
  @IsOptional() @IsString() moduleName?: string;
  @IsOptional() @IsString() crType?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() crCategory?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() requestedBy?: string;
  @IsOptional() @IsString() businessOwner?: string;
  @IsOptional() @IsString() functionalConsultant?: string;
  @IsOptional() @IsString() technicalConsultant?: string;
  @IsOptional() @IsString() projectManager?: string;

  // Change Management (ITIL) — General section
  @IsOptional() @IsString() changeType?: string;
  @IsOptional() @IsString() changeGroup?: string;
  @IsOptional() @IsString() changeOwner?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() impact?: string;
  @IsOptional() @IsString() servicesAffected?: string;
  @IsOptional() @IsString() comments?: string;
  // Roles
  @IsOptional() @IsString() changeCoordinator?: string;
  @IsOptional() @IsString() implementor?: string;
  @IsOptional() @IsString() lineManager?: string;
  @IsOptional() @IsString() reviewer?: string;
  @IsOptional() @IsString() changeApprover?: string;
  @IsOptional() @IsString() changeApproverUserId?: string;
  @IsOptional() @IsObject() stageNotes?: Record<string, string>;
  @IsOptional() @IsIn(['CUSTOMER', 'INTERNAL']) changeSource?: string;

  @IsOptional() @IsDateString() crDate?: string;
  @IsOptional() @IsDateString() crStartDate?: string;
  @IsOptional() @IsDateString() crEndDate?: string;
  @IsOptional() @IsDateString() targetReleaseDate?: string;
  @IsOptional() @IsDateString() expectedGoLiveDate?: string;

  // Business Requirement (Phase 2)
  @IsOptional() @IsString() requirementDetails?: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsString() reasonForCr?: string;
  @IsOptional() @IsString() benefitToCustomer?: string;

  // Blue Print (Phase 3)
  @IsOptional() @IsString() blueprintName?: string;
  @IsOptional() @IsString() blueprintVersionNumber?: string;
  @IsOptional() @IsString() blueprintPreparedBy?: string;
  @IsOptional() @IsString() blueprintReviewedBy?: string;
  @IsOptional() @IsString() blueprintApprovedBy?: string;
  @IsOptional() @IsDateString() blueprintApprovalDate?: string;
  @IsOptional() @IsString() blueprintRemarks?: string;

  // Impact Analysis (Phase 5)
  @IsOptional() @IsString() affectedModule?: string;
  @IsOptional() @IsString() affectedTables?: string;
  @IsOptional() @IsString() impactReports?: string;
  @IsOptional() @IsString() impactInterfaces?: string;
  @IsOptional() @IsString() impactForms?: string;
  @IsOptional() @IsString() impactWorkflow?: string;
  @IsOptional() @IsString() masterData?: string;
  @IsOptional() @IsString() authorizations?: string;
  @IsOptional() @IsString() performance?: string;
  @IsOptional() @IsString() risk?: string;
  @IsOptional() @IsNumber() estimatedHours?: number;
  @IsOptional() @IsString() complexity?: string;

  // Development Details (Phase 6)
  @IsOptional() @IsString() developer?: string;
  @IsOptional() @IsString() developmentStatus?: string;
  @IsOptional() @IsDateString() developmentStartDate?: string;
  @IsOptional() @IsDateString() completionDate?: string;
  @IsOptional() @IsString() transportNumber?: string;
  @IsOptional() @IsString() gitRepository?: string;
  @IsOptional() @IsString() buildNumber?: string;

  // Testing (Phase 7)
  @IsOptional() @IsString() testCase?: string;
  @IsOptional() @IsString() testingPerson?: string;
  @IsOptional() @IsString() testingStatus?: string;
  @IsOptional() @IsString() uatPerformedBy?: string;
  @IsOptional() @IsInt() defectCount?: number;
  @IsOptional() @IsString() retest?: string;
  @IsOptional() @IsString() testApproval?: string;

  // Deployment (Phase 8)
  @IsOptional() @IsString() deploymentPlan?: string;
  @IsOptional() @IsString() goLiveChecklist?: string;
  @IsOptional() @IsString() rollbackPlan?: string;
  @IsOptional() @IsString() transportList?: string;
  @IsOptional() @IsDateString() deploymentDate?: string;
  @IsOptional() @IsString() supportWindow?: string;
}

// --- CR attachments ---

export class CrAttachmentLinkDto {
  @IsString() @IsNotEmpty() entityType!: string;
  @IsString() @IsNotEmpty() url!: string;
  @IsOptional() @IsString() fileName?: string;
  @IsOptional() @IsString() title?: string;
}

// --- CR option store ---

export class CreateCrOptionDto {
  @IsString() @IsNotEmpty() listKey!: string;
  @IsString() @IsNotEmpty() value!: string;
  @IsString() @IsNotEmpty() label!: string;
  @IsOptional() @IsString() parentValue?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateCrOptionDto {
  @IsOptional() @IsString() @IsNotEmpty() value?: string;
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsString() parentValue?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
