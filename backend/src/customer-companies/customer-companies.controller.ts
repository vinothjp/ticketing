import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Request, Res,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { CustomerCompaniesService } from './customer-companies.service';
import { SupportHoursService } from './support-hours.service';
import { CustomerProductsService } from './customer-products.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto } from './dto/customer-company.dto';
import {
  AssignProductDto, UpdateProductTermsDto, RenewAmcDto, GrantRequestDto, DeclineRequestDto, SetContractDto,
  RenewContractDto, AddCustomerConsultantDto, LogUsageDto, DecideExcessDto, SetPoNumberDto,
} from './dto/customer-product.dto';
import { sendWorkbook, stamp } from '../lib/spreadsheet';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StaffGuard } from '../auth/staff.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

/** Consultants read the client screens; only a tenant Admin sees what a client pays. */
const isAdmin = (req: AuthedRequest) => req.user.roles.includes('Admin');

/**
 * Multer config for a PO invoice, on the same template as the client logo:
 * disk storage under uploads/, a type filter, a size cap, and the served path
 * stored on the record. An invoice arrives as a PDF or as a scan, so images are
 * accepted alongside PDFs — `prefix` keeps one client's uploads identifiable on
 * disk, and `originalname` is preserved on the record because the stored name is
 * time-stamped and would read as gibberish in a link.
 */
const PO_INVOICE_TYPES = /^(application\/pdf|image\/)/;
const poInvoiceUpload = (prefix: string, param: string) =>
  FileInterceptor('invoice', {
    storage: diskStorage({
      destination: join(process.cwd(), 'uploads/po'),
      filename: (req: any, file, cb) =>
        cb(null, `${prefix}-${req.params[param]}-${Date.now()}${extname(file.originalname)}`),
    }),
    fileFilter: (_req, file, cb) => {
      if (!PO_INVOICE_TYPES.test(file.mimetype)) {
        cb(new BadRequestException('The PO invoice must be a PDF or an image'), false);
        return;
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  });

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/customer-companies')
export class CustomerCompaniesController {
  constructor(
    private service: CustomerCompaniesService,
    private supportHours: SupportHoursService,
    private customerProducts: CustomerProductsService,
  ) {}

  // ---- Excess support-hours approvals ------------------------------------
  // Readable by any internal staff (the client screens are read-only for
  // consultants); the decision itself is checked in the service, where only the
  // named approver or a tenant Admin gets through.

  /** Open requests this user must decide, across every client — for the bell//badge. */
  @Get('excess-requests/mine')
  @UseGuards(StaffGuard)
  myExcessRequests(@Request() req: AuthedRequest) {
    return this.customerProducts.myPendingExcessRequests(req.user.clientId, req.user.id);
  }

  @Post('excess-requests/:reqId/approve')
  @UseGuards(StaffGuard)
  approveExcess(
    @Param('reqId') reqId: string,
    @Body() body: DecideExcessDto,
    @Request() req: AuthedRequest,
  ) {
    return this.customerProducts.decideExcessRequest(reqId, req.user.clientId, req.user, true, body?.note);
  }

  @Post('excess-requests/:reqId/reject')
  @UseGuards(StaffGuard)
  rejectExcess(
    @Param('reqId') reqId: string,
    @Body() body: DecideExcessDto,
    @Request() req: AuthedRequest,
  ) {
    return this.customerProducts.decideExcessRequest(reqId, req.user.clientId, req.user, false, body?.note);
  }

  // ---- Provider: product requests queue (declared before :id routes) ----
  @Get('product-requests')
  @Roles('Admin')
  listProductRequests(@Request() req: AuthedRequest) {
    return this.customerProducts.listRequests(req.user.clientId);
  }

  // Manual "check coverage now" — the timer also runs this on a schedule.
  @Post('amc/run-sweep')
  @Roles('Admin')
  runAmcSweep() {
    return this.customerProducts.runExpirySweep();
  }

  @Post('product-requests/:reqId/grant')
  @Roles('Admin')
  grantProductRequest(@Param('reqId') reqId: string, @Body() dto: GrantRequestDto, @Request() req: AuthedRequest) {
    return this.customerProducts.grantRequest(reqId, dto, req.user.clientId, req.user.id);
  }

  @Post('product-requests/:reqId/decline')
  @Roles('Admin')
  declineProductRequest(@Param('reqId') reqId: string, @Body() dto: DeclineRequestDto, @Request() req: AuthedRequest) {
    return this.customerProducts.declineRequest(reqId, dto.note, req.user.clientId, req.user.id);
  }

  // ---- Provider: a company's purchased products + AMC/warranty terms ----
  @Get(':id/product-contract')
  @Roles('Admin', 'Viewer')
  getContract(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.getContract(id, req.user.clientId, !isAdmin(req));
  }

  @Put(':id/product-contract')
  @Roles('Admin')
  setContract(@Param('id') id: string, @Body() dto: SetContractDto, @Request() req: AuthedRequest) {
    return this.customerProducts.setContract(id, dto, req.user.clientId, req.user.id);
  }

  @Post(':id/contract-usage')
  @Roles('Admin')
  logContractUsage(@Param('id') id: string, @Body() dto: LogUsageDto, @Request() req: AuthedRequest) {
    return this.customerProducts.logContractUsage(id, dto, req.user.clientId);
  }

  @Post(':id/contract-renew')
  @Roles('Admin')
  renewContract(@Param('id') id: string, @Body() dto: RenewContractDto, @Request() req: AuthedRequest) {
    return this.customerProducts.renewContract(id, dto, req.user.clientId);
  }

  @Get(':id/purchased-products')
  @Roles('Admin', 'Viewer')
  purchasedProducts(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.listCompanyProducts(id, req.user.clientId, !isAdmin(req));
  }

  @Post(':id/purchased-products')
  @Roles('Admin')
  assignProduct(@Param('id') id: string, @Body() dto: AssignProductDto, @Request() req: AuthedRequest) {
    return this.customerProducts.assignProduct(id, dto, req.user.clientId, req.user.id);
  }

  @Patch('purchased-products/:cpId')
  @Roles('Admin')
  updateProductTerms(@Param('cpId') cpId: string, @Body() dto: UpdateProductTermsDto, @Request() req: AuthedRequest) {
    return this.customerProducts.updateTerms(cpId, dto, req.user.clientId, req.user.id);
  }

  // ---- PO invoice (the file; the PO number itself rides the terms above) ----
  // One pair per contract scope, mirroring where the terms are edited: the
  // shared contract's invoice hangs off the company, a per-product one off the
  // purchase. Stored under uploads/po and served at /uploads, so the admin can
  // open it from the client screen whenever they want.

  @Patch('purchased-products/:cpId/po')
  @Roles('Admin')
  setProductPoNumber(@Param('cpId') cpId: string, @Body() dto: SetPoNumberDto, @Request() req: AuthedRequest) {
    return this.customerProducts.setProductPoNumber(cpId, req.user.clientId, dto.poNumber);
  }

  @Post('purchased-products/:cpId/po-invoice')
  @Roles('Admin')
  @UseInterceptors(poInvoiceUpload('cp', 'cpId'))
  uploadProductPoInvoice(
    @Param('cpId') cpId: string, @UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.customerProducts.setProductPoInvoice(cpId, req.user.clientId, {
      url: `/uploads/po/${file.filename}`, name: file.originalname,
    });
  }

  @Delete('purchased-products/:cpId/po-invoice')
  @Roles('Admin')
  removeProductPoInvoice(@Param('cpId') cpId: string, @Request() req: AuthedRequest) {
    return this.customerProducts.clearProductPoInvoice(cpId, req.user.clientId);
  }

  @Post('purchased-products/:cpId/renew')
  @Roles('Admin')
  renewAmc(@Param('cpId') cpId: string, @Body() dto: RenewAmcDto, @Request() req: AuthedRequest) {
    return this.customerProducts.renewAmc(cpId, dto, req.user.clientId);
  }

  @Post('purchased-products/:cpId/usage')
  @Roles('Admin')
  logUsage(@Param('cpId') cpId: string, @Body() dto: LogUsageDto, @Request() req: AuthedRequest) {
    return this.customerProducts.logUsage(cpId, dto, req.user.clientId);
  }

  @Delete('purchased-products/:cpId')
  @Roles('Admin')
  removePurchasedProduct(@Param('cpId') cpId: string, @Request() req: AuthedRequest) {
    return this.customerProducts.removeProduct(cpId, req.user.clientId);
  }

  // ---- Provider: customer-level consultants (auto-assignment overrides) ----
  @Get(':id/excess-requests')
  @Roles('Admin', 'Viewer')
  excessRequests(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.listExcessRequests(req.user.clientId, id);
  }

  @Get(':id/consultants')
  @Roles('Admin', 'Viewer')
  listConsultants(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.listCustomerConsultants(id, req.user.clientId);
  }

  @Post(':id/consultants')
  @Roles('Admin')
  addConsultant(@Param('id') id: string, @Body() dto: AddCustomerConsultantDto, @Request() req: AuthedRequest) {
    return this.customerProducts.addCustomerConsultant(id, dto, req.user.clientId);
  }

  @Delete('consultants/:ccId')
  @Roles('Admin')
  removeCustomerConsultant(@Param('ccId') ccId: string, @Request() req: AuthedRequest) {
    return this.customerProducts.removeCustomerConsultant(ccId, req.user.clientId);
  }

  @Put('consultants/:ccId/primary')
  @Roles('Admin')
  setConsultantPrimary(@Param('ccId') ccId: string, @Request() req: AuthedRequest) {
    return this.customerProducts.setCustomerPrimary(ccId, req.user.clientId);
  }

  @Patch(':id/po')
  @Roles('Admin')
  setContractPoNumber(@Param('id') id: string, @Body() dto: SetPoNumberDto, @Request() req: AuthedRequest) {
    return this.customerProducts.setContractPoNumber(id, req.user.clientId, dto.poNumber);
  }

  @Post(':id/po-invoice')
  @Roles('Admin')
  @UseInterceptors(poInvoiceUpload('contract', 'id'))
  uploadContractPoInvoice(
    @Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.customerProducts.setContractPoInvoice(id, req.user.clientId, {
      url: `/uploads/po/${file.filename}`, name: file.originalname,
    });
  }

  @Delete(':id/po-invoice')
  @Roles('Admin')
  removeContractPoInvoice(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.clearContractPoInvoice(id, req.user.clientId);
  }

  // ---- Client logo (stored on disk under uploads/logos, served at /uploads) ----
  @Post(':id/logo')
  @Roles('Admin')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/logos'),
        filename: (req: any, file, cb) => {
          cb(null, `cc-${req.params.id}-${Date.now()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.setLogo(id, `/uploads/logos/${file.filename}`, req.user.clientId, req.user.id);
  }

  @Delete(':id/logo')
  @Roles('Admin')
  removeLogo(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.removeLogo(id, req.user.clientId, req.user.id);
  }

  // ---- import / export ----
  // Admin-only, like every other write on this controller: the sheet carries the
  // client's contact detail and posting one back adds and edits records.
  // Declared before `:id`, or the param route swallows them.

  /** The client list as a spreadsheet, ready to be edited and posted back. */
  @Get('export')
  @Roles('Admin')
  async exportClients(@Request() req: AuthedRequest, @Res() res: Response) {
    sendWorkbook(res, `clients-${stamp()}.xlsx`, await this.service.exportSheet(req.user.clientId));
  }

  /** The blank import template — the same columns, with an Instructions sheet. */
  @Get('import-template')
  @Roles('Admin')
  clientTemplate(@Res() res: Response) {
    sendWorkbook(res, 'client-import-template.xlsx', this.service.importTemplate());
  }

  /** Bulk add/update, matched on code then name. Answers with a per-row account. */
  @Post('import')
  @Roles('Admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importClients(@UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest) {
    return this.service.importSheet(req.user.clientId, req.user.id, file);
  }

  // One client's core details (declared last so it doesn't shadow static routes).
  @Get(':id')
  @Roles('Admin', 'Viewer')
  getOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.getOne(id, req.user.clientId);
  }

  // Any authenticated staff member may list companies (needed for the ticket
  // filter). StaffGuard blocks customers — a customer must not see the tenant's
  // other client companies.
  @Get()
  @UseGuards(StaffGuard)
  list(@Request() req: AuthedRequest) {
    return this.service.list(req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateCompanyDto, @Request() req: AuthedRequest) {
    return this.service.create(dto, req.user.clientId, req.user.id);
  }

  @Patch(':id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto, @Request() req: AuthedRequest) {
    return this.service.update(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.remove(id, req.user.clientId);
  }

  @Get(':id/products')
  @Roles('Admin')
  getProducts(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.getProducts(id, req.user.clientId);
  }

  // Support-hours usage for one company (staff — e.g. the ticket create banner).
  @Get(':id/support-usage')
  @UseGuards(StaffGuard)
  supportUsage(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.supportHours.usageForCompanyId(id, req.user.clientId);
  }

  @Get(':id/contacts')
  @Roles('Admin')
  listContacts(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.listContacts(id, req.user.clientId);
  }

  @Post(':id/contacts')
  @Roles('Admin')
  addContact(@Param('id') id: string, @Body() dto: CreateContactDto, @Request() req: AuthedRequest) {
    return this.service.addContact(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id/contacts/:userId')
  @Roles('Admin')
  removeContact(@Param('id') id: string, @Param('userId') userId: string, @Request() req: AuthedRequest) {
    return this.service.removeContact(id, userId, req.user.clientId);
  }
}
