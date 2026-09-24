import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT || 3000);
const tokenSecret = process.env.AUTH_SECRET;
const eventClients = new Set();
const corsOrigins = new Set(
  (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

if (!tokenSecret || tokenSecret.length < 32) {
  throw new Error("AUTH_SECRET must contain at least 32 characters");
}

app.use(express.json({ limit: "8mb" }));
app.use((request, response, next) => {
  const origin = request.get("origin");
  if (origin && (corsOrigins.size === 0 || corsOrigins.has("*") || corsOrigins.has(origin))) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }
  if (request.method === "OPTIONS") return response.status(204).end();
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  if (request.path.startsWith("/api")) {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
});

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });

const ensureSystemAdmin = async () => {
  const email = (process.env.ADMIN_EMAIL || "admin@acnetotransportes.com").trim().toLowerCase();
  const fullName = (process.env.ADMIN_NAME || "Administrador").trim();
  const password = process.env.ADMIN_PASSWORD || "admin123456789";

  if (!password || password.length < 12) {
    console.warn("ADMIN_PASSWORD is missing or too short. Using it only for local bootstrap.");
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName, passwordHash },
    create: { email, fullName, passwordHash },
  });

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: { fullName, role: "admin", approved: true },
    create: { userId: user.id, fullName, role: "admin", approved: true },
  });

  console.log(`System admin ready: ${email}`);

  const superAdminEmail = "admin@admin.com";
  const superAdminPasswordHash = await hashPassword("admin12345");
  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: { fullName: "Super Administrador", passwordHash: superAdminPasswordHash },
    create: { email: superAdminEmail, fullName: "Super Administrador", passwordHash: superAdminPasswordHash },
  });
  await prisma.profile.upsert({
    where: { userId: superAdmin.id },
    update: { fullName: "Super Administrador", role: "admin", approved: true, isSuperAdmin: true, financeEnabled: true, negotiationsEnabled: true },
    create: { userId: superAdmin.id, fullName: "Super Administrador", role: "admin", approved: true, isSuperAdmin: true, financeEnabled: true, negotiationsEnabled: true },
  });
  console.log(`Super admin ready: ${superAdminEmail}`);
};

const verifyPassword = async (password, stored) => {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual.split(":")[1], "hex"), Buffer.from(expected, "hex"));
};

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const encodeToken = (payload) => {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString("base64url");
  const signature = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
};

const decodeToken = (token) => {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp > Date.now() ? payload : null;
};

const broadcast = (type) => {
  const payload = `data: ${JSON.stringify({ type, at: Date.now() })}\n\n`;
  for (const client of eventClients) {
    if (client.destroyed || client.writableEnded) {
      eventClients.delete(client);
      continue;
    }
    try {
      client.write(payload);
    } catch {
      eventClients.delete(client);
    }
  }
};

const auth = async (request, response, next) => {
  try {
    const header = request.get("authorization") || "";
    const payload = header.startsWith("Bearer ") ? decodeToken(header.slice(7)) : null;
    if (!payload?.sub) return response.status(401).json({ error: "Não autenticado" });
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        profile: { include: { company: true } },
        driver: {
          include: {
            vehicleAssignments: { where: { endedAt: null }, include: { vehicle: { include: { company: true, products: true } } }, orderBy: { startedAt: "desc" }, take: 1 },
            carrierLinks: { where: { endedAt: null }, include: { company: true }, orderBy: { startedAt: "desc" }, take: 1 },
          },
        },
      },
    });
    if (!user) return response.status(401).json({ error: "Usuário não encontrado" });
    request.user = user;
    next();
  } catch {
    response.status(401).json({ error: "Token inválido" });
  }
};

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  full_name: user.fullName,
  phone: user.phone,
  role: user.profile?.role || "driver",
});

const publicCompany = (company) => company ? ({
  id: company.id,
  name: company.legalName,
  legal_name: company.legalName,
  cnpj: company.cnpj,
  state_registration: company.stateRegistration,
  phone: company.phone,
  address: company.address,
  email: company.email,
  status: company.status,
}) : null;

const publicVehicle = (vehicle) => vehicle ? ({
  id: vehicle.id,
  type: vehicle.type,
  plate: vehicle.plate,
  capacity: vehicle.capacity,
  compartments: vehicle.compartments,
  product_type: vehicle.productType,
  products: vehicle.products?.filter((product) => product.enabled).map((product) => product.product) || [],
  homologation_status: vehicle.homologationStatus,
  company: publicCompany(vehicle.company),
}) : null;

const publicDriver = (driver) => ({
  id: driver.id,
  user_id: driver.userId,
  full_name: driver.fullName,
  cpf: driver.cpf,
  phone: driver.phone,
  email: driver.email,
  vehicle_model: driver.vehicleModel,
  vehicle_year: driver.vehicleYear,
  compartments: driver.compartments,
  plate: driver.plate,
  cnh: driver.cnh,
  cnh_category: driver.cnhCategory,
  cnh_expires_at: driver.cnhExpiresAt?.toISOString() || null,
  city: driver.city,
  state: driver.state,
  homologation_status: driver.homologationStatus,
  location_sharing_authorized: driver.locationSharingAuthorized,
  current_vehicle: publicVehicle(driver.vehicleAssignments?.[0]?.vehicle),
  carrier: publicCompany(driver.carrierLinks?.[0]?.company),
  is_online: driver.isOnline,
  latitude: driver.latitude,
  longitude: driver.longitude,
  last_seen: driver.lastSeen?.toISOString() || null,
  status: driver.status,
  notes: driver.notes,
  availability_city: driver.availabilityCity,
  availability_at: driver.availabilityAt?.toISOString() || null,
  employment_type: driver.employmentType,
  availability_since: driver.availabilitySince?.toISOString() || null,
  rating: driver.rating,
  total_trips: driver.totalTrips,
  created_at: driver.createdAt.toISOString(),
});

const publicOperationalLocation = (location) => ({
  id: location.id,
  kind: location.kind,
  name: location.name,
  email: location.email,
  phone: location.phone,
  address: location.address,
  city: location.city,
  state: location.state,
  latitude: location.latitude,
  longitude: location.longitude,
  active: location.active,
  created_at: location.createdAt.toISOString(),
  updated_at: location.updatedAt.toISOString(),
});

const publicNegotiation = (negotiation) => ({
  id: negotiation.id,
  driver_id: negotiation.driverId,
  driver: negotiation.driver ? publicDriver(negotiation.driver) : null,
  created_by_user_id: negotiation.createdByUserId,
  created_by: negotiation.createdBy ? publicUser(negotiation.createdBy) : null,
  collection_point: negotiation.collectionPoint
    ? publicOperationalLocation(negotiation.collectionPoint)
    : null,
  final_customer: negotiation.finalCustomer
    ? publicOperationalLocation(negotiation.finalCustomer)
    : null,
  cargo: negotiation.cargo,
  product: negotiation.product,
  quantity: negotiation.quantity,
  cte_number: negotiation.cteNumber,
  documents_released: negotiation.documentsReleased,
  loading_scheduled_at: negotiation.loadingScheduledAt?.toISOString() || null,
  distance_km: negotiation.distanceKm,
  price_per_km: negotiation.pricePerKm,
  initial_value: negotiation.initialValue,
  current_value: negotiation.currentValue,
  status: negotiation.status,
  wallet_status: negotiation.walletEntry?.status || null,
  expires_at: negotiation.expiresAt?.toISOString() || null,
  offers: (negotiation.offers || []).map((offer) => ({
    id: offer.id,
    amount: offer.amount,
    message: offer.message,
    status: offer.status,
    user_id: offer.userId,
    user: offer.user ? publicUser(offer.user) : null,
    created_at: offer.createdAt.toISOString(),
  })),
  messages: (negotiation.messages || []).map((message) => ({
    id: message.id,
    body: message.body,
    user_id: message.userId,
    user: message.user ? publicUser(message.user) : null,
    created_at: message.createdAt.toISOString(),
  })),
  created_at: negotiation.createdAt.toISOString(),
  updated_at: negotiation.updatedAt.toISOString(),
});

const negotiationInclude = {
  driver: { include: { carrierLinks: { where: { endedAt: null }, include: { company: true }, take: 1 } } },
  createdBy: true,
  collectionPoint: true,
  finalCustomer: true,
  offers: { include: { user: true }, orderBy: { createdAt: "asc" } },
  messages: { include: { user: true }, orderBy: { createdAt: "asc" } },
  walletEntry: true,
};

const publicWalletEntry = (entry, includeProof = false) => ({
  id: entry.id,
  negotiation_id: entry.negotiationId,
  amount: entry.amount,
  status: entry.status,
  payment_note: entry.paymentNote,
  payment_proof_name: entry.paymentProofName,
  ...(includeProof ? { payment_proof_data: entry.paymentProofData } : { payment_proof_available: Boolean(entry.paymentProofData) }),
  company: entry.company ? publicCompany(entry.company) : null,
  reviewed_at: entry.reviewedAt?.toISOString() || null,
  paid_at: entry.paidAt?.toISOString() || null,
  created_at: entry.createdAt.toISOString(),
  updated_at: entry.updatedAt.toISOString(),
  negotiation: entry.negotiation ? publicNegotiation(entry.negotiation) : null,
});

app.get("/api/health", (_request, response) => response.json({ ok: true }));

app.get("/api/transport-companies", async (_request, response) => {
  const companies = await prisma.transportCompany.findMany({
    select: { id: true, legalName: true, cnpj: true },
    orderBy: { legalName: "asc" },
  });
  response.json({
    companies: companies.map((company) => ({
      id: company.id,
      name: company.legalName,
      cnpj: company.cnpj,
    })),
  });
});

app.get("/api/events", async (request, response) => {
  try {
    const token = typeof request.query.token === "string" ? request.query.token : "";
    const payload = decodeToken(token);
    if (!payload?.sub) return response.status(401).end();
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { profile: true } });
    if (!user) return response.status(401).end();

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`data: ${JSON.stringify({ type: "connected", at: Date.now() })}\n\n`);
    eventClients.add(response);
    const cleanup = () => {
      clearInterval(heartbeat);
      eventClients.delete(response);
    };
    const heartbeat = setInterval(() => {
      if (response.destroyed || response.writableEnded) {
        cleanup();
        return;
      }
      try {
        response.write(": heartbeat\n\n");
      } catch {
        cleanup();
      }
    }, 15000);
    request.on("close", cleanup);
    response.on("error", cleanup);
  } catch {
    if (!response.headersSent) response.status(401).end();
  }
});

app.post("/api/auth/login", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const phone = typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const user = await prisma.user.findUnique({ where: { email }, include: { profile: { include: { company: true } }, driver: true, transportCompany: true } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return response.status(401).json({ error: "E-mail ou senha inválidos" });
  if (!user.profile?.approved) return response.status(403).json({ error: "Conta aguardando aprovação do administrador" });
  response.json({ access_token: encodeToken({ sub: user.id }), user: publicUser(user), profile: user.profile });
});

app.post("/api/auth/change-initial-password", auth, async (request, response) => {
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (password.length < 8) return response.status(400).json({ error: "A nova senha deve ter no mínimo 8 caracteres" });
  const passwordHash = await hashPassword(password);
  const profile = await prisma.profile.update({ where: { userId: request.user.id }, data: { mustChangePassword: false } });
  await prisma.user.update({ where: { id: request.user.id }, data: { passwordHash } });
  response.json({ profile });
});

app.post("/api/auth/signup", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const fullName = typeof request.body?.fullName === "string" ? request.body.fullName.trim() : "";
  const phone = typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const requestedRole = ["driver", "carrier"].includes(request.body?.requestedRole) ? request.body.requestedRole : "driver";
  const registrationNotes = typeof request.body?.registrationNotes === "string" ? request.body.registrationNotes.trim().slice(0, 1000) : null;
  const companyData = request.body?.company || {};
  const legalName = typeof companyData.legalName === "string" ? companyData.legalName.trim() : "";
  const cnpj = typeof companyData.cnpj === "string" ? companyData.cnpj.trim() : "";
  const stateRegistration = typeof companyData.stateRegistration === "string" ? companyData.stateRegistration.trim() || null : null;
  const address = typeof companyData.address === "string" ? companyData.address.trim() : "";
  const driverData = request.body?.driver || {};
  const employmentType = ["autonomous", "carrier"].includes(driverData.employmentType)
    ? driverData.employmentType
    : "autonomous";
  const carrierId = typeof driverData.carrierId === "string" ? driverData.carrierId.trim() : "";
  if (!email || !fullName || !phone || password.length < 6) return response.status(400).json({ error: requestedRole === "carrier" ? "Nome do sócio representante, e-mail, telefone e senha válida são obrigatórios" : "Nome, e-mail, telefone e senha válida são obrigatórios" });
  if (requestedRole === "carrier" && (!legalName || !cnpj || !address)) return response.status(400).json({ error: "Razão social, CNPJ e endereço são obrigatórios para transportadora" });
  if (requestedRole === "driver" && [driverData.cpf, driverData.cnh, driverData.cnhCategory, driverData.cnhExpiresAt, driverData.city, driverData.state, driverData.vehicleModel, driverData.vehicleYear, driverData.plate, driverData.capacity, driverData.compartments].some((value) => value === undefined || value === null || String(value).trim() === "")) return response.status(400).json({ error: "CPF, CNH, categoria, validade, cidade, UF e veículo completo são obrigatórios para motorista" });
  if (requestedRole === "driver" && employmentType === "carrier" && !carrierId) return response.status(400).json({ error: "Selecione a transportadora do motorista" });
  try {
    const carrier = carrierId
      ? await prisma.transportCompany.findUnique({ where: { id: carrierId } })
      : null;
    if (requestedRole === "driver" && employmentType === "carrier" && !carrier) return response.status(400).json({ error: "A transportadora selecionada não está disponível" });
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email, fullName, phone, passwordHash, profile: { create: { fullName, role: requestedRole, requestedRole, registrationNotes, approved: false } }, ...(requestedRole === "driver" ? { driver: { create: { fullName, email, phone, cpf: driverData.cpf?.trim() || null, vehicleModel: driverData.vehicleModel?.trim() || null, vehicleYear: Number.isInteger(driverData.vehicleYear) ? driverData.vehicleYear : null, capacity: driverData.capacity?.trim() || null, compartments: driverData.compartments?.trim() || null, plate: driverData.plate?.trim() || null, cnh: driverData.cnh?.trim() || null, cnhCategory: driverData.cnhCategory?.trim() || null, cnhExpiresAt: driverData.cnhExpiresAt ? new Date(driverData.cnhExpiresAt) : null, city: driverData.city?.trim() || null, state: driverData.state?.trim() || null, locationSharingAuthorized: driverData.locationSharingAuthorized === true, employmentType, homologationStatus: "in_analysis" } } } : {}) } });
      if (requestedRole === "driver" && carrier) {
        const driver = await transaction.driver.findUnique({ where: { userId: user.id } });
        await transaction.driverCarrierLink.create({ data: { driverId: driver.id, companyId: carrier.id } });
      }
      if (requestedRole === "carrier") {
        const company = await transaction.transportCompany.create({ data: { userId: user.id, legalName, cnpj, stateRegistration, phone, address, email, status: "in_analysis" } });
        await transaction.profile.update({ where: { userId: user.id }, data: { companyId: company.id } });
      }
    });
    broadcast("registration-created");
    response.status(202).json({ pending: true, message: "Cadastro recebido. Aguarde a aprovação do administrador." });
  } catch (error) {
    if (error?.code === "P2002") return response.status(409).json({ error: "Este e-mail já está cadastrado" });
    response.status(500).json({ error: "Não foi possível criar a conta" });
  }
});

app.get("/api/auth/me", auth, (request, response) => response.json({ user: publicUser(request.user), profile: request.user.profile }));

app.post("/api/account/change-requests", auth, async (request, response) => {
  const requestedChanges = typeof request.body?.requestedChanges === "string"
    ? request.body.requestedChanges.trim().slice(0, 2000)
    : "";
  if (!requestedChanges) return response.status(400).json({ error: "Descreva a alteração solicitada" });

  const changeRequest = await prisma.accountChangeRequest.create({
    data: { userId: request.user.id, requestedChanges },
  });
  broadcast("account-change-request-created");
  response.status(201).json({
    request: {
      id: changeRequest.id,
      status: changeRequest.status,
      created_at: changeRequest.createdAt.toISOString(),
    },
  });
});

app.post("/api/auth/password-reset/request", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const genericResponse = { message: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação." };
  if (!email) return response.json(genericResponse);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return response.json(genericResponse);

  const rawToken = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  console.log(`Password reset requested for ${email}. Token: ${rawToken}`);
  response.json({
    ...genericResponse,
    ...(process.env.NODE_ENV !== "production" ? { reset_token: rawToken } : {}),
  });
});

app.post("/api/auth/password-reset/confirm", async (request, response) => {
  const token = typeof request.body?.token === "string" ? request.body.token : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!token || password.length < 6) return response.status(400).json({ error: "Token e senha válida são obrigatórios" });

  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(token) } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) return response.status(400).json({ error: "Código de recuperação inválido ou expirado" });

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
  response.json({ message: "Senha redefinida com segurança. Faça login novamente." });
});

const requireAdmin = (request, response, next) => {
  if (request.user.profile?.role !== "admin") return response.status(403).json({ error: "Acesso restrito ao administrador" });
  next();
};

const requireOperations = (request, response, next) => {
  if (!["admin", "operator"].includes(request.user.profile?.role)) return response.status(403).json({ error: "Acesso não permitido" });
  next();
};

const requireFinance = (request, response, next) => {
  if (request.user.profile?.isSuperAdmin === true || request.user.profile?.financeEnabled === true) return next();
  return response.status(403).json({ error: "Acesso ao financeiro não autorizado" });
};

const requireSuperAdmin = (request, response, next) => {
  if (request.user.profile?.isSuperAdmin === true) return next();
  return response.status(403).json({ error: "Acesso restrito ao superadministrador" });
};

const requireNegotiations = (request, response, next) => {
  if (request.user.profile?.isSuperAdmin === true || request.user.profile?.negotiationsEnabled === true) return next();
  if (request.user.driver) return next();
  return response.status(403).json({ error: "Acesso ao módulo de negociações não autorizado" });
};

const requireCarrier = (request, response, next) => {
  if (request.user.profile?.role !== "carrier" || !request.user.profile.companyId) return response.status(403).json({ error: "Acesso restrito à transportadora" });
  next();
};

app.post("/api/admin/users", auth, requireAdmin, async (request, response) => {
  const fullName = typeof request.body?.fullName === "string" ? request.body.fullName.trim() : "";
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const phone = typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const role = ["operator", "admin"].includes(request.body?.role) ? request.body.role : null;
  const initialPassword = typeof request.body?.initialPassword === "string" ? request.body.initialPassword : "";
  const financeEnabled = request.body?.financeEnabled === true && role === "operator";
  const negotiationsEnabled = request.body?.negotiationsEnabled === true && role === "operator";
  if (!fullName || !email || !role || initialPassword.length < 8) return response.status(400).json({ error: "Nome, e-mail, perfil e senha inicial válida são obrigatórios" });
  try {
    const passwordHash = await hashPassword(initialPassword);
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        phone: phone || null,
        passwordHash,
        profile: { create: { fullName, role, requestedRole: role, approved: true, mustChangePassword: true, financeEnabled, negotiationsEnabled } },
      },
      include: { profile: true },
    });
    broadcast("admin-user-created");
    response.status(201).json({ user: publicUser(user), profile: user.profile });
  } catch (error) {
    if (error?.code === "P2002") return response.status(409).json({ error: "Este e-mail já está cadastrado" });
    response.status(400).json({ error: "Não foi possível criar o acesso" });
  }
});

app.patch("/api/admin/users/:userId/finance", auth, requireSuperAdmin, async (request, response) => {
  const profile = await prisma.profile.findUnique({ where: { userId: request.params.userId } });
  if (!profile || profile.role !== "operator") return response.status(404).json({ error: "Operador não encontrado" });
  const updated = await prisma.profile.update({ where: { userId: request.params.userId }, data: { financeEnabled: request.body?.financeEnabled === true } });
  broadcast("finance-permission-updated");
  response.json({ finance_enabled: updated.financeEnabled });
});

app.patch("/api/admin/users/:userId/module", auth, requireSuperAdmin, async (request, response) => {
  const profile = await prisma.profile.findUnique({ where: { userId: request.params.userId } });
  if (!profile || !["operator", "admin"].includes(profile.role) || profile.isSuperAdmin) return response.status(404).json({ error: "Usuário administrativo não encontrado" });
  const moduleName = request.body?.module;
  if (!["finance", "negotiations"].includes(moduleName)) return response.status(400).json({ error: "Módulo inválido" });
  const field = moduleName === "finance" ? "financeEnabled" : "negotiationsEnabled";
  const value = request.body?.enabled === true;
  const updated = await prisma.profile.update({ where: { userId: request.params.userId }, data: { [field]: value } });
  broadcast("module-permission-updated");
  response.json({ module: moduleName, enabled: value, finance_enabled: updated.financeEnabled, negotiations_enabled: updated.negotiationsEnabled });
});

app.patch("/api/admin/users/:userId/password", auth, requireSuperAdmin, async (request, response) => {
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (password.length < 8) return response.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres" });

  const user = await prisma.user.findUnique({ where: { id: request.params.userId }, include: { profile: true } });
  if (!user?.profile) return response.status(404).json({ error: "Usuário não encontrado" });

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.profile.update({ where: { userId: user.id }, data: { mustChangePassword: true } }),
  ]);
  broadcast("user-password-updated");
  response.json({ updated: true });
});

app.get("/api/admin/module-users", auth, requireSuperAdmin, async (_request, response) => {
  const profiles = await prisma.profile.findMany({
    where: { userId: { not: _request.user.id } },
    include: { user: true },
    orderBy: { fullName: "asc" },
  });
  response.json({ users: profiles.map((profile) => ({ id: profile.userId, name: profile.fullName ?? profile.user.fullName ?? "Usuário", email: profile.user.email, role: profile.role, is_super_admin: profile.isSuperAdmin, finance_enabled: profile.financeEnabled, negotiations_enabled: profile.negotiationsEnabled })) });
});

app.get("/api/admin/pending-users", auth, requireOperations, async (_request, response) => {
  const isOperator = _request.user.profile?.role === "operator";
  const profiles = await prisma.profile.findMany({
    where: {
      approved: false,
      approvalClosed: false,
      ...(isOperator ? { requestedRole: { in: ["driver", "carrier"] } } : {}),
    },
    include: { user: { include: { driver: { include: { carrierLinks: { where: { endedAt: null }, include: { company: true }, take: 1 } } } } }, company: true },
    orderBy: { createdAt: "asc" },
  });
  response.json({ users: profiles.map((profile) => ({ id: profile.userId, profile_id: profile.id, full_name: profile.fullName, email: profile.user.email, phone: profile.user.phone, role: profile.role, requested_role: profile.requestedRole, company_id: profile.companyId, company: profile.company ? { legal_name: profile.company.legalName, cnpj: profile.company.cnpj, state_registration: profile.company.stateRegistration, phone: profile.company.phone, address: profile.company.address, email: profile.company.email, status: profile.company.status } : null, registration_notes: profile.registrationNotes, driver: profile.user.driver ? { full_name: profile.user.driver.fullName, phone: profile.user.driver.phone, cpf: profile.user.driver.cpf, cnh: profile.user.driver.cnh, cnh_category: profile.user.driver.cnhCategory, cnh_expires_at: profile.user.driver.cnhExpiresAt?.toISOString() || "", vehicle_model: profile.user.driver.vehicleModel, plate: profile.user.driver.plate, vehicle_year: profile.user.driver.vehicleYear, city: profile.user.driver.city, state: profile.user.driver.state, capacity: profile.user.driver.capacity, compartments: profile.user.driver.compartments, employment_type: profile.user.driver.employmentType, carrier: profile.user.driver.carrierLinks?.[0]?.company ? publicCompany(profile.user.driver.carrierLinks[0].company) : null, location_sharing_authorized: profile.user.driver.locationSharingAuthorized } : null, created_at: profile.createdAt.toISOString() })) });
});

app.get("/api/admin/registration-requests", auth, requireAdmin, async (_request, response) => {
  const profiles = await prisma.profile.findMany({
    where: { approved: false },
    include: { user: { include: { driver: { include: { carrierLinks: { where: { endedAt: null }, include: { company: true }, take: 1 } } } } }, company: true },
    orderBy: { createdAt: "desc" },
  });
  response.json({
    users: profiles.map((profile) => ({
      id: profile.userId,
      profile_id: profile.id,
      full_name: profile.fullName,
      email: profile.user.email,
      phone: profile.user.phone,
      role: profile.role,
      requested_role: profile.requestedRole,
      registration_notes: profile.registrationNotes,
      company_id: profile.companyId,
      company: profile.company ? { legal_name: profile.company.legalName, cnpj: profile.company.cnpj, state_registration: profile.company.stateRegistration, phone: profile.company.phone, address: profile.company.address, email: profile.company.email, status: profile.company.status } : null,
      driver: profile.user.driver ? { full_name: profile.user.driver.fullName, phone: profile.user.driver.phone, cpf: profile.user.driver.cpf, cnh: profile.user.driver.cnh, cnh_category: profile.user.driver.cnhCategory, cnh_expires_at: profile.user.driver.cnhExpiresAt?.toISOString() || "", vehicle_model: profile.user.driver.vehicleModel, plate: profile.user.driver.plate, vehicle_year: profile.user.driver.vehicleYear, city: profile.user.driver.city, state: profile.user.driver.state, capacity: profile.user.driver.capacity, compartments: profile.user.driver.compartments, employment_type: profile.user.driver.employmentType, carrier: profile.user.driver.carrierLinks?.[0]?.company ? publicCompany(profile.user.driver.carrierLinks[0].company) : null, location_sharing_authorized: profile.user.driver.locationSharingAuthorized } : null,
      approval_closed: profile.approvalClosed,
      created_at: profile.createdAt.toISOString(),
    }))
  });
});

app.patch("/api/admin/users/:userId/close-approval", auth, requireAdmin, async (request, response) => {
  const profile = await prisma.profile.updateMany({
    where: { userId: request.params.userId, approved: false },
    data: { approvalClosed: true },
  });
  if (profile.count === 0) return response.status(404).json({ error: "Solicitação não encontrada ou já aprovada" });
  broadcast("registration-approval-closed");
  response.json({ closed: true });
});

app.patch("/api/admin/users/:userId/reopen-approval", auth, requireAdmin, async (request, response) => {
  const profile = await prisma.profile.updateMany({
    where: { userId: request.params.userId, approved: false },
    data: { approvalClosed: false },
  });
  if (profile.count === 0) return response.status(404).json({ error: "Solicitação não encontrada ou já aprovada" });
  broadcast("registration-approval-reopened");
  response.json({ reopened: true });
});

app.delete("/api/admin/users/:userId/reject", auth, requireOperations, async (request, response) => {
  const user = await prisma.user.findUnique({
    where: { id: request.params.userId },
    include: { profile: true, transportCompany: true },
  });
  if (!user?.profile) return response.status(404).json({ error: "Solicitação não encontrada" });
  if (user.profile.approved) return response.status(400).json({ error: "Cadastros aprovados não podem ser rejeitados por esta ação" });

  await prisma.$transaction(async (transaction) => {
    if (user.transportCompany) {
      await transaction.vehicle.deleteMany({
        where: { companyId: user.transportCompany.id },
      });
      await transaction.transportCompany.delete({ where: { id: user.transportCompany.id } });
    }
    await transaction.user.delete({ where: { id: user.id } });
  });
  broadcast("registration-rejected");
  response.status(204).end();
});

app.delete("/api/admin/users/:userId/remove", auth, requireAdmin, async (request, response) => {
  const user = await prisma.user.findUnique({
    where: { id: request.params.userId },
    include: { profile: true, transportCompany: true },
  });
  if (!user?.profile) return response.status(404).json({ error: "Usuário não encontrado" });
  if (user.profile.role === "admin") return response.status(400).json({ error: "Administradores não podem ser removidos por esta ação" });

  await prisma.$transaction(async (transaction) => {
    if (user.transportCompany) {
      await transaction.vehicle.deleteMany({ where: { companyId: user.transportCompany.id } });
      await transaction.transportCompany.delete({ where: { id: user.transportCompany.id } });
    }
    await transaction.user.delete({ where: { id: user.id } });
  });
  broadcast("admin-user-removed");
  response.status(204).end();
});

app.patch("/api/admin/users/:userId/approve", auth, requireOperations, async (request, response) => {
  const assignedRole = ["driver", "carrier", "operator", "admin"].includes(request.body?.role) ? request.body.role : null;
  if (!assignedRole) return response.status(400).json({ error: "Informe um perfil válido" });
  if (request.user.profile?.role === "operator" && !["driver", "carrier"].includes(assignedRole)) {
    return response.status(403).json({ error: "Operadores só podem aprovar motoristas e transportadoras" });
  }
  const user = await prisma.user.findUnique({ where: { id: request.params.userId }, include: { profile: true, driver: true, transportCompany: true } });
  if (!user?.profile) return response.status(404).json({ error: "Cadastro não encontrado" });
  if (user.profile.approvalClosed) return response.status(400).json({ error: "Reabra a solicitação antes de aprovar" });
  if (!user.fullName?.trim() || !user.email?.trim() || !user.phone?.trim()) {
    return response.status(400).json({ error: "Nome, e-mail e telefone do cadastro são obrigatórios" });
  }
  if (assignedRole === "carrier" && (!user.transportCompany?.legalName?.trim() || !user.transportCompany.cnpj?.trim() || !user.transportCompany.phone?.trim() || !user.transportCompany.address?.trim() || !user.transportCompany.email?.trim())) {
    return response.status(400).json({ error: "Confira razão social, CNPJ, telefone, endereço e e-mail da transportadora antes de aprovar" });
  }
  const driverData = request.body?.driver || {};
  const requiredDriverFields = user.profile.companyId
    ? ["fullName", "phone"]
    : ["fullName", "phone", "cpf", "cnh", "cnhCategory", "cnhExpiresAt", "vehicleModel", "vehicleYear", "plate", "city", "state", "capacity", "compartments"];
  if (assignedRole === "driver" && requiredDriverFields.some((field) => typeof driverData[field] !== "string" || !driverData[field].trim())) {
    return response.status(400).json({ error: "Preencha todos os campos obrigatórios do motorista antes de aprovar" });
  }
  const initialPassword = typeof request.body?.initialPassword === "string" ? request.body.initialPassword : "";
  if (["operator", "admin"].includes(assignedRole) && initialPassword.length < 8) {
    return response.status(400).json({ error: "Informe uma senha inicial com no mínimo 8 caracteres" });
  }
  const initialPasswordHash = ["operator", "admin"].includes(assignedRole)
    ? await hashPassword(initialPassword)
    : null;
  const profile = await prisma.$transaction(async (transaction) => {
    const updatedProfile = await transaction.profile.update({ where: { userId: request.params.userId }, data: { approved: true, role: assignedRole, mustChangePassword: ["operator", "admin"].includes(assignedRole) } });
    if (assignedRole === "carrier" && user.transportCompany) {
      await transaction.transportCompany.update({ where: { id: user.transportCompany.id }, data: { status: "active" } });
    }
    if (initialPasswordHash) await transaction.user.update({ where: { id: user.id }, data: { passwordHash: initialPasswordHash } });
    if (assignedRole === "driver" && !user.driver) {
      const approvedDriver = await transaction.driver.create({ data: { userId: user.id, fullName: driverData.fullName.trim(), email: user.email, phone: driverData.phone.trim(), vehicleModel: driverData.vehicleModel?.trim() || null, vehicleYear: driverData.vehicleYear ? Number(driverData.vehicleYear) : null, plate: driverData.plate?.trim() || null, city: driverData.city?.trim() || null, state: driverData.state?.trim() || null, capacity: driverData.capacity?.trim() || null, compartments: driverData.compartments?.trim() || null, cpf: driverData.cpf?.trim() || null, cnh: driverData.cnh?.trim() || null, cnhCategory: driverData.cnhCategory?.trim() || null, cnhExpiresAt: driverData.cnhExpiresAt ? new Date(driverData.cnhExpiresAt) : null, locationSharingAuthorized: driverData.locationSharingAuthorized === true, employmentType: user.profile.companyId ? "carrier" : "autonomous", homologationStatus: "active" } });
      if (user.profile.companyId) await transaction.driverCarrierLink.create({ data: { driverId: approvedDriver.id, companyId: user.profile.companyId } });
    } else if (assignedRole === "driver" && user.driver) {
      await transaction.driver.update({ where: { id: user.driver.id }, data: { fullName: driverData.fullName.trim(), email: user.email, phone: driverData.phone.trim(), vehicleModel: driverData.vehicleModel === undefined ? user.driver.vehicleModel : driverData.vehicleModel.trim() || null, vehicleYear: driverData.vehicleYear === undefined ? user.driver.vehicleYear : Number(driverData.vehicleYear), plate: driverData.plate === undefined ? user.driver.plate : driverData.plate.trim() || null, city: driverData.city === undefined ? user.driver.city : driverData.city.trim() || null, state: driverData.state === undefined ? user.driver.state : driverData.state.trim() || null, capacity: driverData.capacity === undefined ? user.driver.capacity : driverData.capacity.trim() || null, compartments: driverData.compartments === undefined ? user.driver.compartments : driverData.compartments.trim() || null, cpf: driverData.cpf === undefined ? user.driver.cpf : driverData.cpf.trim() || null, cnh: driverData.cnh === undefined ? user.driver.cnh : driverData.cnh.trim() || null, cnhCategory: driverData.cnhCategory === undefined ? user.driver.cnhCategory : driverData.cnhCategory.trim() || null, cnhExpiresAt: driverData.cnhExpiresAt === undefined ? user.driver.cnhExpiresAt : driverData.cnhExpiresAt ? new Date(driverData.cnhExpiresAt) : null, locationSharingAuthorized: driverData.locationSharingAuthorized === undefined ? user.driver.locationSharingAuthorized : driverData.locationSharingAuthorized === true, employmentType: user.profile.companyId ? "carrier" : user.driver.employmentType, homologationStatus: "active" } });
    }
    return updatedProfile;
  });
  broadcast("registration-approved");
  response.json({ profile });
});

app.get("/api/drivers/me", auth, async (request, response) => {
  if (!request.user.driver) return response.status(404).json({ error: "Motorista ainda não cadastrado" });
  response.json({ driver: publicDriver(request.user.driver) });
});

app.patch("/api/drivers/me", auth, async (request, response) => {
  if (!request.user.driver) return response.status(404).json({ error: "Motorista ainda não cadastrado" });
  const body = request.body || {};
  const allowed = ["fullName", "cpf", "phone", "email", "vehicleModel", "vehicleYear", "capacity", "compartments", "plate", "cnh", "cnhCategory", "cnhExpiresAt", "city", "state", "notes", "locationSharingAuthorized"];
  const data = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  if (data.cnhExpiresAt) data.cnhExpiresAt = new Date(data.cnhExpiresAt);
  await prisma.driver.update({ where: { id: request.user.driver.id }, data });
  const driver = await prisma.driver.findUnique({
    where: { id: request.user.driver.id },
    include: {
      vehicleAssignments: { where: { endedAt: null }, include: { vehicle: { include: { company: true, products: true } } }, orderBy: { startedAt: "desc" }, take: 1 },
      carrierLinks: { where: { endedAt: null }, include: { company: true }, orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  broadcast("driver-updated");
  response.json({ driver: publicDriver(driver) });
});

app.patch("/api/drivers/me/location", auth, async (request, response) => {
  if (!request.user.driver) return response.status(404).json({ error: "Motorista ainda não cadastrado" });
  const { latitude, longitude } = request.body || {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return response.status(400).json({ error: "Coordenadas inválidas" });
  const driver = await prisma.driver.update({ where: { id: request.user.driver.id }, data: { latitude, longitude, lastSeen: new Date() } });
  broadcast("driver-location");
  response.json({ driver: publicDriver(driver) });
});

app.patch("/api/drivers/me/status", auth, async (request, response) => {
  if (!request.user.driver) return response.status(404).json({ error: "Motorista ainda não cadastrado" });
  const { isOnline, status, notes } = request.body || {};
  const validStatuses = ["offline", "available", "awaiting_loading", "awaiting_documents", "in_transit", "at_collection", "awaiting_unloading", "driver_completed", "in_negotiation", "on_trip"];
  if (typeof isOnline !== "boolean" || !validStatuses.includes(status)) return response.status(400).json({ error: "Status inválido" });
  const availabilityAt = typeof request.body?.availabilityAt === "string" && request.body.availabilityAt
    ? new Date(request.body.availabilityAt)
    : null;
  if (isOnline && (!Number.isFinite(availabilityAt?.getTime()) || typeof request.body?.availabilityCity !== "string" || !request.body.availabilityCity.trim())) {
    return response.status(400).json({ error: "Informe a cidade, a data e o horário previstos para ficar disponível" });
  }
  const driver = await prisma.driver.update({ where: { id: request.user.driver.id }, data: { isOnline, status, notes, lastSeen: new Date(), availabilityCity: isOnline ? request.body.availabilityCity.trim() : request.user.driver.availabilityCity, availabilityAt: isOnline ? availabilityAt : request.user.driver.availabilityAt, availabilitySince: isOnline ? new Date() : request.user.driver.availabilitySince } });
  broadcast("driver-status");
  response.json({ driver: publicDriver(driver) });
});

const negotiationStatuses = ["pending", "countered", "accepted", "in_transit", "at_collection", "driver_completed", "rejected", "cancelled", "expired", "completed"];
const negotiationOpenStatuses = ["pending", "countered"];
const conversationStatuses = ["pending", "countered", "accepted", "in_transit", "at_collection", "driver_completed", "completed"];
const isOperationsUser = (request) => ["admin", "operator"].includes(request.user.profile?.role);
const parseBrazilianMoney = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  const normalized = value.replace(/R\$|\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized);
};

const loadNegotiationForRequest = async (request) => {
  const negotiation = await prisma.freightNegotiation.findUnique({
    where: { id: request.params.negotiationId },
    include: negotiationInclude,
  });
  if (!negotiation) return null;
  const isDriver = request.user.driver?.id === negotiation.driverId;
  if (!isDriver && !isOperationsUser(request)) return false;
  return negotiation;
};

app.post("/api/negotiations/from-route", auth, requireOperations, requireNegotiations, async (request, response) => {
  const body = request.body || {};
  const driverId = typeof body.driverId === "string" ? body.driverId : "";
  const collectionPointId = typeof body.collectionPointId === "string" ? body.collectionPointId : "";
  const finalCustomerId = typeof body.finalCustomerId === "string" ? body.finalCustomerId : "";
  const pricePerKm = parseBrazilianMoney(body.pricePerKm);
  if (!driverId || !collectionPointId || !finalCustomerId || !Number.isFinite(pricePerKm) || pricePerKm <= 0) {
    return response.status(400).json({ error: "Motorista, origem, destino e valor por quilômetro são obrigatórios" });
  }
  const [driver, collectionPoint, finalCustomer] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId } }),
    prisma.operationalLocation.findUnique({ where: { id: collectionPointId } }),
    prisma.operationalLocation.findUnique({ where: { id: finalCustomerId } }),
  ]);
  const points = [driver, collectionPoint, finalCustomer];
  if (!driver || !collectionPoint || collectionPoint.kind !== "collection_point" || !finalCustomer || finalCustomer.kind !== "final_customer") {
    return response.status(400).json({ error: "Motorista, posto e cliente precisam existir e ter tipos válidos" });
  }
  if (points.some((point) => !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))) {
    return response.status(400).json({ error: "Motorista, posto e cliente precisam possuir coordenadas GPS" });
  }
  const coordinates = points.map((point) => `${point.longitude},${point.latitude}`).join(";");
  const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=false`);
  if (!routeResponse.ok) return response.status(502).json({ error: "Serviço de rotas indisponível" });
  const routeBody = await routeResponse.json();
  const route = routeBody.routes?.[0];
  if (routeBody.code !== "Ok" || !route || !Number.isFinite(route.distance) || route.distance <= 0) return response.status(422).json({ error: "Não foi possível calcular a distância da rota" });
  const distanceKm = route.distance / 1000;
  const value = distanceKm * pricePerKm;
  const negotiation = await prisma.freightNegotiation.create({
    data: {
      driverId,
      createdByUserId: request.user.id,
      collectionPointId,
      finalCustomerId,
      cargo: typeof body.cargo === "string" ? body.cargo.trim().slice(0, 200) || null : null,
      product: typeof body.product === "string" ? body.product.trim().slice(0, 200) || null : null,
      quantity: typeof body.quantity === "string" ? body.quantity.trim().slice(0, 100) || null : null,
      cteNumber: typeof body.cteNumber === "string" ? body.cteNumber.trim().slice(0, 100) || null : null,
      documentsReleased: body.documentsReleased === true,
      distanceKm,
      pricePerKm,
      initialValue: value,
      currentValue: value,
    },
    include: negotiationInclude,
  });
  broadcast("negotiation-created");
  response.status(201).json({ negotiation: publicNegotiation(negotiation), route: { distance_km: distanceKm, duration_seconds: route.duration } });
});

app.post("/api/negotiations", auth, requireOperations, requireNegotiations, async (request, response) => {
  const body = request.body || {};
  const driverId = typeof body.driverId === "string" ? body.driverId : "";
  const collectionPointId = typeof body.collectionPointId === "string" ? body.collectionPointId : "";
  const finalCustomerId = typeof body.finalCustomerId === "string" ? body.finalCustomerId : "";
  const initialValue = parseBrazilianMoney(body.initialValue);
  const distanceKm = body.distanceKm == null ? null : Number(body.distanceKm);
  const pricePerKm = body.pricePerKm == null ? null : parseBrazilianMoney(body.pricePerKm);
  const calculatedValue = Number.isFinite(distanceKm) && distanceKm > 0 && Number.isFinite(pricePerKm) && pricePerKm > 0
    ? distanceKm * pricePerKm
    : initialValue;
  if (!driverId || !collectionPointId || !finalCustomerId || !Number.isFinite(calculatedValue) || calculatedValue <= 0) {
    return response.status(400).json({ error: "Motorista, origem, destino e valor válido são obrigatórios" });
  }
  if (distanceKm != null && (!Number.isFinite(distanceKm) || distanceKm <= 0)) return response.status(400).json({ error: "Informe uma distância em quilômetros válida" });
  if (pricePerKm != null && (!Number.isFinite(pricePerKm) || pricePerKm <= 0)) return response.status(400).json({ error: "Informe um valor por quilômetro válido" });
  if (collectionPointId === finalCustomerId) return response.status(400).json({ error: "Origem e destino devem ser diferentes" });
  const [driver, collectionPoint, finalCustomer] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId } }),
    prisma.operationalLocation.findUnique({ where: { id: collectionPointId } }),
    prisma.operationalLocation.findUnique({ where: { id: finalCustomerId } }),
  ]);
  if (!driver) return response.status(404).json({ error: "Motorista não encontrado" });
  if (!collectionPoint || collectionPoint.kind !== "collection_point" || !finalCustomer || finalCustomer.kind !== "final_customer") {
    return response.status(400).json({ error: "Selecione um posto de coleta e um cliente final válidos" });
  }
  const negotiation = await prisma.freightNegotiation.create({
    data: {
      driverId,
      createdByUserId: request.user.id,
      collectionPointId,
      finalCustomerId,
      cargo: typeof body.cargo === "string" ? body.cargo.trim().slice(0, 200) || null : null,
      quantity: typeof body.quantity === "string" ? body.quantity.trim().slice(0, 100) || null : null,
      distanceKm,
      pricePerKm,
      initialValue: calculatedValue,
      currentValue: calculatedValue,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
    include: negotiationInclude,
  });
  broadcast("negotiation-created");
  response.status(201).json({ negotiation: publicNegotiation(negotiation) });
});

app.patch("/api/negotiations/:negotiationId/pricing", auth, requireOperations, requireNegotiations, async (request, response) => {
  const negotiation = await prisma.freightNegotiation.findUnique({ where: { id: request.params.negotiationId } });
  if (!negotiation) return response.status(404).json({ error: "Negociação não encontrada" });
  if (!negotiationOpenStatuses.includes(negotiation.status)) return response.status(409).json({ error: "Somente negociações abertas podem ter o valor alterado" });
  const distanceKm = parseBrazilianMoney(request.body?.distanceKm);
  const pricePerKm = parseBrazilianMoney(request.body?.pricePerKm);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(pricePerKm) || pricePerKm <= 0) return response.status(400).json({ error: "Distância e valor por quilômetro devem ser positivos" });
  const currentValue = distanceKm * pricePerKm;
  const updated = await prisma.freightNegotiation.update({ where: { id: negotiation.id }, data: { distanceKm, pricePerKm, currentValue }, include: negotiationInclude });
  broadcast("negotiation-pricing-updated");
  response.json({ negotiation: publicNegotiation(updated) });
});

app.patch("/api/operations/negotiations/:negotiationId/preparation", auth, requireOperations, async (request, response) => {
  const negotiation = await prisma.freightNegotiation.findUnique({ where: { id: request.params.negotiationId } });
  if (!negotiation) return response.status(404).json({ error: "Negociação não encontrada" });
  if (!["accepted", "awaiting_loading"].includes(negotiation.status)) return response.status(409).json({ error: "O frete precisa estar aceito ou em preparação" });
  const updated = await prisma.freightNegotiation.update({
    where: { id: negotiation.id },
    data: {
      status: "awaiting_loading",
      product: typeof request.body?.product === "string" ? request.body.product.trim().slice(0, 200) : negotiation.product,
      cteNumber: typeof request.body?.cteNumber === "string" ? request.body.cteNumber.trim().slice(0, 100) : negotiation.cteNumber,
      documentsReleased: request.body?.documentsReleased === true,
      loadingScheduledAt: request.body?.loadingScheduledAt ? new Date(request.body.loadingScheduledAt) : negotiation.loadingScheduledAt,
    },
    include: negotiationInclude,
  });
  broadcast("freight-preparation-updated");
  response.json({ negotiation: publicNegotiation(updated) });
});

app.get("/api/negotiations", auth, requireNegotiations, async (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status : "";
  if (status && !negotiationStatuses.includes(status)) return response.status(400).json({ error: "Status de negociação inválido" });
  const where = {
    ...(request.user.driver ? { driverId: request.user.driver.id } : isOperationsUser(request) ? {} : { id: "__none__" }),
    ...(status ? { status } : {}),
    ...(!status ? { status: { not: "completed" } } : {}),
  };
  const negotiations = await prisma.freightNegotiation.findMany({ where, include: negotiationInclude, orderBy: { updatedAt: "desc" } });
  response.json({ negotiations: negotiations.map(publicNegotiation) });
});

app.get("/api/negotiations/:negotiationId", auth, requireNegotiations, async (request, response) => {
  const negotiation = await loadNegotiationForRequest(request);
  if (negotiation === false) return response.status(403).json({ error: "Você não participa desta negociação" });
  if (!negotiation) return response.status(404).json({ error: "Negociação não encontrada" });
  response.json({ negotiation: publicNegotiation(negotiation) });
});

app.post("/api/negotiations/:negotiationId/offer", auth, requireNegotiations, async (request, response) => {
  const negotiation = await loadNegotiationForRequest(request);
  if (negotiation === false) return response.status(403).json({ error: "Você não participa desta negociação" });
  if (!negotiation) return response.status(404).json({ error: "Negociação não encontrada" });
  if (!negotiationOpenStatuses.includes(negotiation.status)) return response.status(409).json({ error: "Esta negociação não aceita novas ofertas" });
  const amount = parseBrazilianMoney(request.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return response.status(400).json({ error: "Informe um valor de oferta válido" });
  const nextStatus = request.user.driver ? "countered" : "pending";
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.freightNegotiationOffer.updateMany({ where: { negotiationId: negotiation.id, status: "pending" }, data: { status: "superseded" } });
    await transaction.freightNegotiationOffer.create({ data: { negotiationId: negotiation.id, userId: request.user.id, amount, message: typeof request.body?.message === "string" ? request.body.message.trim().slice(0, 500) || null : null } });
    return transaction.freightNegotiation.update({ where: { id: negotiation.id }, data: { currentValue: amount, status: nextStatus }, include: negotiationInclude });
  });
  broadcast("negotiation-offer-created");
  response.status(201).json({ negotiation: publicNegotiation(updated) });
});

app.post("/api/negotiations/:negotiationId/messages", auth, requireNegotiations, async (request, response) => {
  const negotiation = await loadNegotiationForRequest(request);
  if (negotiation === false) return response.status(403).json({ error: "Você não participa desta negociação" });
  if (!negotiation) return response.status(404).json({ error: "Negociação não encontrada" });
  if (!conversationStatuses.includes(negotiation.status)) return response.status(409).json({ error: "Esta negociação não aceita novas mensagens" });
  const body = typeof request.body?.body === "string" ? request.body.body.trim().slice(0, 1000) : "";
  if (!body) return response.status(400).json({ error: "A mensagem não pode ficar vazia" });
  await prisma.freightNegotiationMessage.create({ data: { negotiationId: negotiation.id, userId: request.user.id, body } });
  const updated = await prisma.freightNegotiation.findUnique({ where: { id: negotiation.id }, include: negotiationInclude });
  broadcast("negotiation-message-created");
  response.status(201).json({ negotiation: publicNegotiation(updated) });
});

app.post("/api/negotiations/:negotiationId/:action", auth, requireNegotiations, async (request, response) => {
  const action = request.params.action;
  const transitions = { accept: "accepted", reject: "rejected", cancel: "cancelled", complete: "completed" };
  const nextStatus = transitions[action];
  if (!nextStatus) return response.status(404).json({ error: "Ação de negociação inválida" });
  const negotiation = await loadNegotiationForRequest(request);
  if (negotiation === false) return response.status(403).json({ error: "Você não participa desta negociação" });
  if (!negotiation) return response.status(404).json({ error: "Negociação não encontrada" });
  if (!negotiationOpenStatuses.includes(negotiation.status) && action !== "complete") return response.status(409).json({ error: "Esta negociação já foi encerrada" });
  if (action === "complete") return response.status(409).json({ error: "A conclusão deve ser feita pelo fluxo de conferência financeira" });
  if (action === "cancel" && !isOperationsUser(request)) return response.status(403).json({ error: "Somente a operação pode cancelar a negociação" });
  if (action === "accept" && !request.user.driver) return response.status(403).json({ error: "Somente o motorista pode aceitar a oferta" });
  if (action === "reject" && !request.user.driver) return response.status(403).json({ error: "Somente o motorista pode rejeitar a oferta" });
  const updated = await prisma.$transaction(async (transaction) => {
    const updatedNegotiation = await transaction.freightNegotiation.update({ where: { id: negotiation.id }, data: { status: nextStatus }, include: negotiationInclude });
    if (action === "complete") {
      await transaction.driverWalletEntry.upsert({
        where: { negotiationId: negotiation.id },
        update: { amount: updatedNegotiation.currentValue, status: "pending_review" },
        create: { driverId: negotiation.driverId, negotiationId: negotiation.id, amount: updatedNegotiation.currentValue, status: "pending_review" },
      });
    }
    return updatedNegotiation;
  });
  broadcast(`negotiation-${action}ed`);
  response.json({ negotiation: publicNegotiation(updated) });
});

app.get("/api/drivers/me/wallet", auth, async (request, response) => {
  if (!request.user.driver) return response.status(404).json({ error: "Motorista ainda não cadastrado" });
  const entries = await prisma.driverWalletEntry.findMany({
    where: { driverId: request.user.driver.id },
    include: { company: true, negotiation: { include: negotiationInclude } },
    orderBy: { createdAt: "desc" },
  });
  const activeEntries = entries.filter((entry) => entry.status !== "rejected");
  const total = activeEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const pending = entries.filter((entry) => ["pending_review", "approved"].includes(entry.status)).reduce((sum, entry) => sum + entry.amount, 0);
  const paid = entries.filter((entry) => entry.status === "paid").reduce((sum, entry) => sum + entry.amount, 0);
  response.json({
    summary: { total, pending, paid, completed_freights: activeEntries.length },
    entries: entries.map((entry) => publicWalletEntry(entry, entry.status === "paid")),
  });
});

app.get("/api/operations/wallet", auth, requireFinance, async (_request, response) => {
  const entries = await prisma.driverWalletEntry.findMany({
    where: { status: { in: ["pending_review", "approved", "paid", "rejected"] } },
    include: { company: true, driver: true, negotiation: { include: negotiationInclude } },
    orderBy: { createdAt: "asc" },
  });
  response.json({ entries: entries.map((entry) => ({ ...publicWalletEntry(entry, true), driver: { id: entry.driver.id, full_name: entry.driver.fullName } })) });
});

app.post("/api/operations/negotiations/:negotiationId/settle", auth, requireFinance, async (request, response) => {
  const action = request.body?.action;
  if (!["approve", "reject", "pay"].includes(action)) return response.status(400).json({ error: "Informe uma ação financeira válida" });
  const entry = await prisma.driverWalletEntry.findUnique({ where: { negotiationId: request.params.negotiationId }, include: { negotiation: true } });
  if (!entry) return response.status(404).json({ error: "Lançamento financeiro não encontrado" });
  if (action === "approve" && entry.status !== "pending_review") return response.status(409).json({ error: "Este frete não está aguardando conferência" });
  if (action === "pay" && entry.status !== "approved") return response.status(409).json({ error: "O pagamento precisa ser aprovado antes" });
  if (action === "pay" && (!request.body?.paymentProofName || !request.body?.paymentProofData)) return response.status(400).json({ error: "Anexe o comprovante da transferência" });
  if (action === "pay") {
    const proofName = String(request.body.paymentProofName).toLowerCase();
    const allowedExtension = /\.(pdf|jpg|jpeg)$/.test(proofName);
    const proofData = String(request.body.paymentProofData);
    const allowedMime = /^(data:application\/pdf|data:image\/(jpeg|jpg));base64,/.test(proofData);
    if (!allowedExtension || !allowedMime) return response.status(400).json({ error: "O comprovante deve ser PDF, JPG ou JPEG" });
  }
  if (action === "reject" && !["pending_review", "approved"].includes(entry.status)) return response.status(409).json({ error: "Este lançamento não pode ser rejeitado" });
  const updated = await prisma.$transaction(async (transaction) => {
    if (action === "approve") {
      await transaction.freightNegotiation.update({ where: { id: entry.negotiationId }, data: { status: "completed" } });
      return transaction.driverWalletEntry.update({ where: { id: entry.id }, data: { status: "approved", reviewedById: request.user.id, reviewedAt: new Date(), paymentNote: request.body?.note?.trim() || null }, include: { company: true, negotiation: { include: negotiationInclude } } });
    }
    if (action === "pay") return transaction.driverWalletEntry.update({ where: { id: entry.id }, data: { status: "paid", paidAt: new Date(), paymentNote: request.body?.note?.trim() || entry.paymentNote, paymentProofName: request.body.paymentProofName.trim().slice(0, 255), paymentProofData: request.body.paymentProofData }, include: { company: true, negotiation: { include: negotiationInclude } } });
    await transaction.freightNegotiation.update({ where: { id: entry.negotiationId }, data: { status: "at_collection" } });
    return transaction.driverWalletEntry.update({ where: { id: entry.id }, data: { status: "rejected", reviewedById: request.user.id, reviewedAt: new Date(), paymentNote: request.body?.note?.trim() || "Frete devolvido para conferência" }, include: { company: true, negotiation: { include: negotiationInclude } } });
  });
  broadcast(`freight-payment-${action}`);
  response.json({ entry: publicWalletEntry(updated, true) });
});

app.post("/api/negotiations/:negotiationId/freight/:step", auth, requireNegotiations, async (request, response) => {
  const negotiation = await loadNegotiationForRequest(request);
  if (negotiation === false) return response.status(403).json({ error: "Você não participa deste frete" });
  if (!negotiation) return response.status(404).json({ error: "Frete não encontrado" });
  if (!request.user.driver) return response.status(403).json({ error: "Somente o motorista pode atualizar esta etapa" });
  const transitions = {
    start: { from: "accepted", to: "awaiting_loading", driverStatus: "awaiting_loading" },
    depart: { from: "awaiting_loading", to: "in_transit", driverStatus: "in_transit" },
    arrive: { from: "in_transit", to: "at_collection", driverStatus: "awaiting_loading" },
    finish: { from: "in_transit", to: "driver_completed", driverStatus: "available" },
  };
  const transition = transitions[request.params.step];
  if (!transition) return response.status(404).json({ error: "Etapa de frete inválida" });
  if (negotiation.status !== transition.from) return response.status(409).json({ error: `O frete precisa estar em ${transition.from} para avançar` });
  const updated = await prisma.$transaction(async (transaction) => {
    const updatedNegotiation = await transaction.freightNegotiation.update({ where: { id: negotiation.id }, data: { status: transition.to }, include: negotiationInclude });
    await transaction.driver.update({ where: { id: request.user.driver.id }, data: { status: transition.driverStatus, isOnline: true, lastSeen: new Date() } });
    if (request.params.step === "finish") {
      await transaction.driverWalletEntry.upsert({
        where: { negotiationId: negotiation.id },
        update: { amount: updatedNegotiation.currentValue, status: "pending_review", paymentNote: null, reviewedById: null, reviewedAt: null, paidAt: null },
        create: { driverId: negotiation.driverId, negotiationId: negotiation.id, companyId: negotiation.driver.carrierLinks?.[0]?.companyId ?? null, amount: updatedNegotiation.currentValue, status: "pending_review" },
      });
    }
    return updatedNegotiation;
  });
  broadcast(`freight-${request.params.step}`);
  response.json({ negotiation: publicNegotiation(updated), driver_status: transition.driverStatus });
});

app.get("/api/drivers", auth, async (request, response) => {
  if (!['operator', 'admin'].includes(request.user.profile?.role)) return response.status(403).json({ error: "Acesso não permitido" });
  const activeSince = new Date(Date.now() - 2 * 60 * 1000);
  const drivers = await prisma.driver.findMany({
    where: { isOnline: true, lastSeen: { gte: activeSince } },
    include: { vehicleAssignments: { where: { endedAt: null }, include: { vehicle: { include: { company: true } } }, orderBy: { startedAt: "desc" }, take: 1 }, carrierLinks: { where: { endedAt: null }, include: { company: true }, orderBy: { startedAt: "desc" }, take: 1 } },
    orderBy: { availabilitySince: "asc" },
  });
  response.json({ drivers: drivers.map(publicDriver) });
});

const validLocationKinds = ["collection_point", "final_customer"];

const locationPayload = (body = {}) => {
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const data = {
    kind,
    name,
    email: typeof body.email === "string" ? body.email.trim() || null : null,
    phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
    address: typeof body.address === "string" ? body.address.trim() || null : null,
    city: typeof body.city === "string" ? body.city.trim() || null : null,
    state: typeof body.state === "string" ? body.state.trim() || null : null,
    latitude: body.latitude == null ? null : Number(body.latitude),
    longitude: body.longitude == null ? null : Number(body.longitude),
    active: body.active !== false,
  };
  if (!validLocationKinds.includes(kind)) throw new Error("Tipo de ponto operacional inválido");
  if (!name) throw new Error("Nome do ponto operacional é obrigatório");
  if (data.latitude != null && (!Number.isFinite(data.latitude) || data.latitude < -90 || data.latitude > 90)) throw new Error("Latitude inválida");
  if (data.longitude != null && (!Number.isFinite(data.longitude) || data.longitude < -180 || data.longitude > 180)) throw new Error("Longitude inválida");
  return data;
};

app.get("/api/operations/locations", auth, requireOperations, async (_request, response) => {
  const locations = await prisma.operationalLocation.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  const companies = request.user.profile?.role === "admin"
    ? await prisma.transportCompany.findMany({ include: { vehicles: true }, orderBy: { legalName: "asc" } })
    : [];
  response.json({ locations: locations.map(publicOperationalLocation) });
});

app.post("/api/operations/locations", auth, requireOperations, async (request, response) => {
  try {
    const location = await prisma.operationalLocation.create({ data: locationPayload(request.body) });
    broadcast("operational-location-created");
    response.status(201).json({ location: publicOperationalLocation(location) });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Ponto operacional inválido" });
  }
});

app.patch("/api/operations/locations/:locationId", auth, requireOperations, async (request, response) => {
  try {
    const location = await prisma.operationalLocation.update({ where: { id: request.params.locationId }, data: locationPayload(request.body) });
    broadcast("operational-location-updated");
    response.json({ location: publicOperationalLocation(location) });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Ponto operacional inválido" });
  }
});

app.delete("/api/operations/locations/:locationId", auth, requireOperations, async (request, response) => {
  await prisma.operationalLocation.update({ where: { id: request.params.locationId }, data: { active: false } });
  broadcast("operational-location-deleted");
  response.status(204).end();
});

app.post("/api/operations/routes", auth, requireOperations, async (request, response) => {
  const { driverId, collectionPointId, finalCustomerId } = request.body || {};
  const [driver, collectionPoint, finalCustomer] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId } }),
    prisma.operationalLocation.findUnique({ where: { id: collectionPointId } }),
    prisma.operationalLocation.findUnique({ where: { id: finalCustomerId } }),
  ]);
  const points = [driver, collectionPoint, finalCustomer];
  if (!driver || !collectionPoint || !finalCustomer || collectionPoint.kind !== "collection_point" || finalCustomer.kind !== "final_customer") return response.status(400).json({ error: "Motorista, posto de coleta e cliente final são obrigatórios" });
  if (points.some((point) => !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))) return response.status(400).json({ error: "Todos os pontos precisam ter coordenadas GPS" });
  const coordinates = points.map((point) => `${point.longitude},${point.latitude}`).join(";");
  const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`);
  if (!routeResponse.ok) return response.status(502).json({ error: "Serviço de rotas indisponível" });
  const routeBody = await routeResponse.json();
  const route = routeBody.routes?.[0];
  if (routeBody.code !== "Ok" || !route) return response.status(422).json({ error: "Não foi possível calcular a rota entre os pontos" });
  response.json({ order: ["driver", "collection_point", "final_customer"], distance: route.distance, duration: route.duration, geometry: route.geometry });
});

app.get("/api/operations/directory", auth, requireOperations, async (request, response) => {
  const activeSince = new Date(Date.now() - 2 * 60 * 1000);
  const driverRelations = { vehicleAssignments: { where: { endedAt: null }, include: { vehicle: { include: { company: true, products: true } } }, orderBy: { startedAt: "desc" }, take: 1 }, carrierLinks: { where: { endedAt: null }, include: { company: true }, orderBy: { startedAt: "desc" }, take: 1 } };
  const drivers = await prisma.driver.findMany({
    where: { isOnline: true, lastSeen: { gte: activeSince } },
    include: driverRelations,
    orderBy: { availabilitySince: "asc" },
  });
  const allDrivers = ["admin", "operator"].includes(request.user.profile?.role)
    ? await prisma.driver.findMany({ include: driverRelations, orderBy: { fullName: "asc" } })
    : [];
  const operators = request.user.profile?.role === "admin"
    ? await prisma.user.findMany({
      where: { profile: { role: "operator", approved: true } },
      include: { profile: true },
      orderBy: { fullName: "asc" },
    })
    : [];
  const locations = await prisma.operationalLocation.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  const companies = request.user.profile?.role === "admin"
    ? await prisma.transportCompany.findMany({ include: { vehicles: true }, orderBy: { legalName: "asc" } })
    : [];

  response.json({
    drivers: drivers.map(publicDriver),
    all_drivers: allDrivers.map(publicDriver),
    operators: operators.map((operator) => ({
      id: operator.id,
      full_name: operator.fullName,
      email: operator.email,
      phone: operator.phone,
      role: operator.profile?.role,
      finance_enabled: operator.profile?.financeEnabled === true,
      negotiations_enabled: operator.profile?.negotiationsEnabled === true,
    })),
    locations: locations.map(publicOperationalLocation),
    companies: companies.map((company) => ({
      id: company.id,
      name: company.legalName,
      cnpj: company.cnpj,
      status: company.status,
    })),
    vehicles: companies.flatMap((company) => company.vehicles.map((vehicle) => ({
      id: vehicle.id,
      type: vehicle.type,
      plate: vehicle.plate,
      capacity: vehicle.capacity || "",
      compartments: vehicle.compartments || "",
      products: vehicle.productType || "",
      companyId: company.id,
      driverId: "",
      status: vehicle.homologationStatus,
    }))),
  });
});

app.get("/api/carrier/registrations", auth, requireCarrier, async (request, response) => {
  const companyId = request.user.profile.companyId;
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { carrierLinks: { some: { companyId, endedAt: null } } }, orderBy: { fullName: "asc" } }),
    prisma.vehicle.findMany({ where: { companyId }, include: { products: true, driverAssignments: { where: { endedAt: null }, include: { driver: true }, orderBy: { startedAt: "desc" }, take: 1 } }, orderBy: { plate: "asc" } }),
  ]);
  response.json({ drivers: drivers.map(publicDriver), vehicles: vehicles.map((vehicle) => ({ id: vehicle.id, type: vehicle.type, plate: vehicle.plate, capacity: vehicle.capacity, products: vehicle.products.filter((product) => product.enabled).map((product) => product.product), status: vehicle.homologationStatus, current_driver: vehicle.driverAssignments[0]?.driver ? { id: vehicle.driverAssignments[0].driver.id, full_name: vehicle.driverAssignments[0].driver.fullName } : null })) });
});

app.post("/api/carrier/drivers", auth, requireCarrier, async (request, response) => {
  const fullName = typeof request.body?.fullName === "string" ? request.body.fullName.trim() : "";
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const phone = typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!fullName || !email || !phone || password.length < 6) return response.status(400).json({ error: "Nome, e-mail, telefone e senha válida são obrigatórios" });
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({ data: { fullName, email, phone, passwordHash, profile: { create: { fullName, role: "driver", requestedRole: "driver", companyId: request.user.profile.companyId, approved: false, registrationNotes: "Cadastro criado pela transportadora" } } } });
    broadcast("registration-created");
    response.status(202).json({ pending: true, user: { id: user.id, full_name: fullName, email, phone } });
  } catch (error) {
    if (error?.code === "P2002") return response.status(409).json({ error: "Este e-mail já está cadastrado" });
    response.status(400).json({ error: "Não foi possível solicitar o cadastro do motorista" });
  }
});

app.post("/api/carrier/vehicles", auth, requireCarrier, async (request, response) => {
  const type = typeof request.body?.type === "string" ? request.body.type.trim() : "";
  const plate = typeof request.body?.plate === "string" ? request.body.plate.trim().toUpperCase() : "";
  const products = Array.isArray(request.body?.products) ? request.body.products.filter((product) => typeof product === "string" && product.trim()).map((product) => product.trim()) : [];
  if (!type || !plate) return response.status(400).json({ error: "Tipo e placa são obrigatórios" });
  try {
    const vehicle = await prisma.vehicle.create({ data: { companyId: request.user.profile.companyId, type, plate, capacity: request.body?.capacity?.trim() || null, compartments: request.body?.compartments?.trim() || null, homologationStatus: "in_analysis", products: { create: products.map((product) => ({ product })) } }, include: { products: true } });
    broadcast("vehicle-registration-created");
    response.status(202).json({ vehicle: { id: vehicle.id, type: vehicle.type, plate: vehicle.plate, status: vehicle.homologationStatus, products: vehicle.products.map((product) => product.product) } });
  } catch (error) {
    if (error?.code === "P2002") return response.status(409).json({ error: "Esta placa já está cadastrada" });
    response.status(400).json({ error: "Não foi possível solicitar o cadastro do veículo" });
  }
});

app.post("/api/carrier/vehicles/:vehicleId/driver", auth, requireCarrier, async (request, response) => {
  const companyId = request.user.profile.companyId;
  const driverId = typeof request.body?.driverId === "string" ? request.body.driverId : "";
  const [vehicle, driver] = await Promise.all([
    prisma.vehicle.findFirst({ where: { id: request.params.vehicleId, companyId } }),
    prisma.driver.findFirst({ where: { id: driverId, carrierLinks: { some: { companyId, endedAt: null } } } }),
  ]);
  if (!vehicle || !driver) return response.status(404).json({ error: "Veículo ou motorista não pertence à transportadora" });
  if (vehicle.homologationStatus !== "active" || driver.homologationStatus !== "active") return response.status(409).json({ error: "Veículo e motorista precisam estar ativos para criar o vínculo" });
  const assignment = await prisma.$transaction(async (transaction) => {
    await transaction.vehicleDriverAssignment.updateMany({ where: { vehicleId: vehicle.id, endedAt: null }, data: { endedAt: new Date(), status: "ended" } });
    return transaction.vehicleDriverAssignment.create({ data: { vehicleId: vehicle.id, driverId: driver.id } });
  });
  broadcast("vehicle-driver-linked");
  response.status(201).json({ assignment });
});

app.get("/api/admin/pending-vehicles", auth, requireOperations, async (_request, response) => {
  const vehicles = await prisma.vehicle.findMany({ where: { homologationStatus: "in_analysis" }, include: { company: true, products: true }, orderBy: { createdAt: "asc" } });
  response.json({ vehicles: vehicles.map((vehicle) => ({ id: vehicle.id, type: vehicle.type, plate: vehicle.plate, capacity: vehicle.capacity, company: publicCompany(vehicle.company), products: vehicle.products.map((product) => product.product), status: vehicle.homologationStatus })) });
});

app.patch("/api/admin/vehicles/:vehicleId/approval", auth, requireOperations, async (request, response) => {
  const status = ["active", "rejected", "blocked"].includes(request.body?.status) ? request.body.status : null;
  if (!status) return response.status(400).json({ error: "Informe uma situação válida" });
  const vehicle = await prisma.vehicle.update({ where: { id: request.params.vehicleId }, data: { homologationStatus: status } });
  broadcast("vehicle-approval-updated");
  response.json({ vehicle: { id: vehicle.id, status: vehicle.homologationStatus } });
});

app.post("/api/operations/vehicles/:vehicleId/driver", auth, requireOperations, async (request, response) => {
  const { driverId } = request.body || {};
  if (typeof driverId !== "string" || !driverId) return response.status(400).json({ error: "Motorista é obrigatório" });
  try {
    const assignment = await prisma.$transaction(async (transaction) => {
      const vehicle = await transaction.vehicle.findUnique({ where: { id: request.params.vehicleId } });
      const driver = await transaction.driver.findUnique({ where: { id: driverId } });
      if (!vehicle || !driver) throw new Error("Veículo ou motorista não encontrado");
      await transaction.vehicleDriverAssignment.updateMany({ where: { vehicleId: vehicle.id, endedAt: null }, data: { endedAt: new Date(), status: "ended" } });
      return transaction.vehicleDriverAssignment.create({ data: { vehicleId: vehicle.id, driverId: driver.id } });
    });
    broadcast("vehicle-driver-linked");
    response.status(201).json({ assignment });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível vincular o motorista" });
  }
});

app.delete("/api/operations/vehicles/:vehicleId/driver", auth, requireOperations, async (request, response) => {
  const result = await prisma.vehicleDriverAssignment.updateMany({ where: { vehicleId: request.params.vehicleId, endedAt: null }, data: { endedAt: new Date(), status: "ended" } });
  if (result.count === 0) return response.status(404).json({ error: "Vínculo ativo não encontrado" });
  broadcast("vehicle-driver-unlinked");
  response.status(204).end();
});

app.post("/api/operations/drivers/:driverId/carrier", auth, requireOperations, async (request, response) => {
  const { companyId } = request.body || {};
  if (typeof companyId !== "string" || !companyId) return response.status(400).json({ error: "Transportadora é obrigatória" });
  try {
    const link = await prisma.$transaction(async (transaction) => {
      const [driver, company] = await Promise.all([
        transaction.driver.findUnique({ where: { id: request.params.driverId } }),
        transaction.transportCompany.findUnique({ where: { id: companyId } }),
      ]);
      if (!driver || !company) throw new Error("Motorista ou transportadora não encontrado");
      await transaction.driverCarrierLink.updateMany({ where: { driverId: driver.id, endedAt: null }, data: { endedAt: new Date(), status: "ended" } });
      await transaction.driver.update({ where: { id: driver.id }, data: { employmentType: "carrier" } });
      return transaction.driverCarrierLink.create({ data: { driverId: driver.id, companyId: company.id } });
    });
    broadcast("driver-carrier-linked");
    response.status(201).json({ link });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível vincular a transportadora" });
  }
});

app.patch("/api/admin/drivers/:driverId", auth, requireOperations, async (request, response) => {
  const allowed = ["fullName", "email", "vehicleModel", "vehicleYear", "plate", "phone", "capacity", "compartments", "city", "state", "notes", "rating", "employmentType"];
  const data = Object.fromEntries(Object.entries(request.body || {}).filter(([key]) => allowed.includes(key)));
  if (data.employmentType && !["autonomous", "carrier"].includes(data.employmentType)) return response.status(400).json({ error: "Tipo de vínculo inválido" });
  const carrierId = typeof request.body?.carrierId === "string" ? request.body.carrierId : "";
  if (data.employmentType === "carrier" && !carrierId) return response.status(400).json({ error: "Selecione a transportadora do motorista" });
  const driver = await prisma.$transaction(async (transaction) => {
    const updatedDriver = await transaction.driver.update({ where: { id: request.params.driverId }, data });
    if (data.employmentType === "autonomous") {
      await transaction.driverCarrierLink.updateMany({ where: { driverId: updatedDriver.id, endedAt: null }, data: { endedAt: new Date(), status: "ended" } });
    } else if (data.employmentType === "carrier" && carrierId) {
      const company = await transaction.transportCompany.findUnique({ where: { id: carrierId } });
      if (!company) throw new Error("A transportadora selecionada não está disponível");
      await transaction.driverCarrierLink.updateMany({ where: { driverId: updatedDriver.id, endedAt: null }, data: { endedAt: new Date(), status: "ended" } });
      await transaction.driverCarrierLink.create({ data: { driverId: updatedDriver.id, companyId: company.id } });
    }
    return transaction.driver.findUnique({ where: { id: updatedDriver.id }, include: { carrierLinks: { where: { endedAt: null }, include: { company: true }, take: 1 } } });
  });
  broadcast("driver-updated");
  response.json({ driver: publicDriver(driver) });
});

app.delete("/api/admin/drivers/:driverId", auth, requireOperations, async (request, response) => {
  const driver = await prisma.driver.findUnique({ where: { id: request.params.driverId } });
  if (!driver) return response.status(404).json({ error: "Motorista não encontrado" });
  await prisma.user.delete({ where: { id: driver.userId } });
  broadcast("driver-deleted");
  response.status(204).end();
});

const distPath = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (request, response, next) => {
    if (request.path.startsWith("/api")) return next();
    response.sendFile(path.join(distPath, "index.html"));
  });
}

await ensureSystemAdmin();

const server = app.listen(port, "0.0.0.0", () => console.log(`API listening on ${port}`));
const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);