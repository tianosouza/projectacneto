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
const eventClients = new Map();
const corsOrigins = new Set(
  (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const isProduction = process.env.NODE_ENV === "production";

if (!tokenSecret || tokenSecret.length < 32) {
  throw new Error("AUTH_SECRET must contain at least 32 characters");
}

app.use(express.json({ limit: "20mb" }));
app.use((request, response, next) => {
  const origin = request.get("origin");
  if (
    origin &&
    ((corsOrigins.size === 0 && !isProduction) ||
      corsOrigins.has("*") ||
      corsOrigins.has(origin))
  ) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
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

const hashPassword = (
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });

const ensureSystemAdmin = async () => {
  const email = (process.env.ADMIN_EMAIL || "admin@acnetotransportes.com")
    .trim()
    .toLowerCase();
  const fullName = (process.env.ADMIN_NAME || "Administrador").trim();
  const configuredPassword = process.env.ADMIN_PASSWORD;

  if (isProduction && (!configuredPassword || configuredPassword.length < 12)) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
  }
  const password = configuredPassword || "admin123456789";

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

  const superAdminEmail = (process.env.SUPERADMIN_EMAIL || "admin@admin.com")
    .trim()
    .toLowerCase();
  const superAdminPassword =
    process.env.SUPERADMIN_PASSWORD || (isProduction ? "" : "admin12345");
  if (isProduction && superAdminPassword.length < 12) {
    console.warn(
      "SUPERADMIN_PASSWORD not set (min. 12 chars): super admin was not created or updated.",
    );
    return;
  }
  const superAdminPasswordHash = await hashPassword(superAdminPassword);
  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      fullName: "Super Administrador",
      passwordHash: superAdminPasswordHash,
    },
    create: {
      email: superAdminEmail,
      fullName: "Super Administrador",
      passwordHash: superAdminPasswordHash,
    },
  });
  await prisma.profile.upsert({
    where: { userId: superAdmin.id },
    update: {
      fullName: "Super Administrador",
      role: "admin",
      approved: true,
      isSuperAdmin: true,
    },
    create: {
      userId: superAdmin.id,
      fullName: "Super Administrador",
      role: "admin",
      approved: true,
      isSuperAdmin: true,
    },
  });
  console.log(`Super admin ready: ${superAdminEmail}`);
};

const verifyPassword = async (password, stored) => {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = await hashPassword(password, salt);
  return crypto.timingSafeEqual(
    Buffer.from(actual.split(":")[1], "hex"),
    Buffer.from(expected, "hex"),
  );
};

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Remove pontuação e caixa para que "123.456.789-09" e "12345678909" contem como o mesmo documento.
const normalizeDocument = (value) =>
  String(value ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase() || null;

const uniqueConflictMessage = (error) => {
  const target = JSON.stringify(error?.meta ?? {}).toLowerCase();
  if (target.includes("cpf")) return "Este CPF já está cadastrado";
  if (target.includes("cnpj")) return "Este CNPJ já está cadastrado";
  if (target.includes("cnh")) return "Esta CNH já está cadastrada";
  if (target.includes("plate")) return "Esta placa já está cadastrada";
  if (target.includes("email")) return "Este e-mail já está cadastrado";
  return "Já existe um cadastro com estes dados";
};

// Padroniza CPF/CNH/CNPJ de registros antigos (com pontuação). Em conflito, mantém o valor original e avisa.
const normalizeStoredDocuments = async () => {
  const fix = async (delegate, id, field, value) => {
    const normalized = normalizeDocument(value);
    if (!value || normalized === value) return;
    try {
      await delegate.update({ where: { id }, data: { [field]: normalized } });
    } catch (error) {
      if (error?.code === "P2002")
        console.warn(`Documento duplicado ignorado (${field}, id ${id}).`);
      else throw error;
    }
  };
  for (const driver of await prisma.driver.findMany({
    select: { id: true, cpf: true, cnh: true },
  })) {
    await fix(prisma.driver, driver.id, "cpf", driver.cpf);
    await fix(prisma.driver, driver.id, "cnh", driver.cnh);
  }
  for (const company of await prisma.transportCompany.findMany({
    select: { id: true, cnpj: true },
  }))
    await fix(prisma.transportCompany, company.id, "cnpj", company.cnpj);
};

// Data de nascimento no formato AAAA-MM-DD (valor do <input type="date">). Retorna null se inválida.
const normalizeBirthDate = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  )
    return null;
  if (date > new Date() || date.getUTCFullYear() < 1900) return null;
  return text;
};

const sameSecret = (first, second) =>
  crypto.timingSafeEqual(
    crypto.createHash("sha256").update(String(first)).digest(),
    crypto.createHash("sha256").update(String(second)).digest(),
  );

// Limite de tentativas da recuperação de senha (por e-mail e por IP), janela de 15 minutos.
const resetRequestAttempts = new Map();
const resetRequestLimited = (key, max) => {
  const now = Date.now();
  const recent = (resetRequestAttempts.get(key) || []).filter(
    (time) => now - time < 15 * 60 * 1000,
  );
  recent.push(now);
  resetRequestAttempts.set(key, recent);
  return recent.length > max;
};

const encodeToken = (payload) => {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", tokenSecret)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
};

const decodeToken = (token) => {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto
    .createHmac("sha256", tokenSecret)
    .update(body)
    .digest("base64url");
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp > Date.now() ? payload : null;
};

const broadcast = (type, recipientUserId = null) => {
  const payload = `data: ${JSON.stringify({ type, at: Date.now() })}\n\n`;
  for (const [client, userId] of eventClients) {
    if (recipientUserId && recipientUserId !== userId) continue;
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
    const payload = header.startsWith("Bearer ")
      ? decodeToken(header.slice(7))
      : null;
    if (!payload?.sub)
      return response.status(401).json({ error: "Não autenticado" });
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        profile: { include: { company: true } },
        driver: {
          include: {
            vehicleAssignments: {
              where: { endedAt: null },
              include: {
                vehicle: { include: { company: true, products: true } },
              },
              orderBy: { startedAt: "desc" },
              take: 1,
            },
            carrierLinks: {
              where: { endedAt: null },
              include: { company: true },
              orderBy: { startedAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!user)
      return response.status(401).json({ error: "Usuário não encontrado" });
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
  birth_date: user.birthDate ?? null,
  role: user.profile?.role || "driver",
});

const publicCompany = (company) =>
  company
    ? {
        id: company.id,
        name: company.legalName,
        legal_name: company.legalName,
        cnpj: company.cnpj,
        state_registration: company.stateRegistration,
        phone: company.phone,
        address: company.address,
        email: company.email,
        status: company.status,
      }
    : null;

const publicVehicle = (vehicle) =>
  vehicle
    ? {
        id: vehicle.id,
        type: vehicle.type,
        plate: vehicle.plate,
        capacity: vehicle.capacity,
        compartments: vehicle.compartments,
        product_type: vehicle.productType,
        products:
          vehicle.products
            ?.filter((product) => product.enabled)
            .map((product) => product.product) || [],
        homologation_status: vehicle.homologationStatus,
        company: publicCompany(vehicle.company),
      }
    : null;

const publicDriver = (driver) => ({
  id: driver.id,
  user_id: driver.userId,
  full_name: driver.fullName,
  cpf: driver.cpf,
  phone: driver.phone,
  email: driver.email,
  vehicle_model: driver.vehicleModel,
  vehicle_year: driver.vehicleYear,
  capacity: driver.capacity,
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
  employment_type: driver.employmentType,
  availability_since: driver.availabilitySince?.toISOString() || null,
  availability_city: driver.availabilityCity,
  availability_at: driver.availabilityAt?.toISOString() || null,
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
  company_ids:
    location.companyAccesses?.map((access) => access.companyId) ?? [],
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
    const token =
      typeof request.query.token === "string" ? request.query.token : "";
    const payload = decodeToken(token);
    if (!payload?.sub) return response.status(401).end();
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { profile: true },
    });
    if (!user) return response.status(401).end();

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(
      `data: ${JSON.stringify({ type: "connected", at: Date.now() })}\n\n`,
    );
    eventClients.set(response, user.id);
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
  const email =
    typeof request.body?.email === "string"
      ? request.body.email.trim().toLowerCase()
      : "";
  const password =
    typeof request.body?.password === "string" ? request.body.password : "";
  const phone =
    typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      profile: { include: { company: true } },
      driver: true,
      transportCompany: true,
    },
  });
  if (!user || !(await verifyPassword(password, user.passwordHash)))
    return response.status(401).json({ error: "E-mail ou senha inválidos" });
  if (!user.profile?.approved)
    return response
      .status(403)
      .json({ error: "Conta aguardando aprovação do administrador" });
  response.json({
    access_token: encodeToken({ sub: user.id }),
    user: publicUser(user),
    profile: user.profile,
  });
});

app.post(
  "/api/auth/change-initial-password",
  auth,
  async (request, response) => {
    const password =
      typeof request.body?.password === "string" ? request.body.password : "";
    if (password.length < 8)
      return response
        .status(400)
        .json({ error: "A nova senha deve ter no mínimo 8 caracteres" });
    const passwordHash = await hashPassword(password);
    const profile = await prisma.profile.update({
      where: { userId: request.user.id },
      data: { mustChangePassword: false },
    });
    await prisma.user.update({
      where: { id: request.user.id },
      data: { passwordHash },
    });
    response.json({ profile });
  },
);

app.post("/api/auth/signup", async (request, response) => {
  const email =
    typeof request.body?.email === "string"
      ? request.body.email.trim().toLowerCase()
      : "";
  const fullName =
    typeof request.body?.fullName === "string"
      ? request.body.fullName.trim()
      : "";
  const phone =
    typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const password =
    typeof request.body?.password === "string" ? request.body.password : "";
  const requestedRole = ["driver", "carrier", "client"].includes(
    request.body?.requestedRole,
  )
    ? request.body.requestedRole
    : "driver";
  const registrationNotes =
    typeof request.body?.registrationNotes === "string"
      ? request.body.registrationNotes.trim().slice(0, 1000)
      : null;
  const companyData = request.body?.company || {};
  const legalName =
    typeof companyData.legalName === "string"
      ? companyData.legalName.trim()
      : "";
  const cnpj = normalizeDocument(companyData.cnpj) ?? "";
  const stateRegistration =
    typeof companyData.stateRegistration === "string"
      ? companyData.stateRegistration.trim() || null
      : null;
  const address =
    typeof companyData.address === "string" ? companyData.address.trim() : "";
  const driverData = request.body?.driver || {};
  const attachments = Array.isArray(request.body?.attachments)
    ? request.body.attachments
    : [];
  const allowedAttachmentTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  if (["driver", "carrier"].includes(requestedRole) && attachments.length === 0)
    return response
      .status(400)
      .json({ error: "Anexe ao menos um documento para continuar" });
  if (attachments.length > 5)
    return response.status(400).json({ error: "Anexe no máximo 5 arquivos" });
  if (attachments.length && !["driver", "carrier"].includes(requestedRole))
    return response.status(400).json({
      error:
        "Anexos estão disponíveis apenas para motoristas e transportadoras",
    });
  let attachmentBytes = 0;
  const validatedAttachments = [];
  for (const attachment of attachments) {
    if (
      typeof attachment?.data !== "string" ||
      typeof attachment?.name !== "string"
    )
      return response.status(400).json({ error: "Um dos anexos é inválido" });
    const match = attachment.data.match(
      /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/,
    );
    if (!match || !allowedAttachmentTypes.has(match[1]))
      return response
        .status(400)
        .json({ error: "Use arquivos PDF, JPG, PNG ou WebP" });
    const fileBuffer = Buffer.from(match[2], "base64");
    if (fileBuffer.toString("base64") !== match[2])
      return response
        .status(400)
        .json({ error: "Um dos anexos está corrompido" });
    const signatureMatches = {
      "application/pdf": fileBuffer.subarray(0, 5).toString() === "%PDF-",
      "image/jpeg":
        fileBuffer[0] === 0xff &&
        fileBuffer[1] === 0xd8 &&
        fileBuffer[2] === 0xff,
      "image/png": fileBuffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      "image/webp":
        fileBuffer.subarray(0, 4).toString() === "RIFF" &&
        fileBuffer.subarray(8, 12).toString() === "WEBP",
    };
    if (!signatureMatches[match[1]] || fileBuffer.length > 5 * 1024 * 1024)
      return response
        .status(400)
        .json({ error: "Cada arquivo deve ser válido e ter no máximo 5 MB" });
    attachmentBytes += fileBuffer.length;
    if (attachmentBytes > 12 * 1024 * 1024)
      return response
        .status(400)
        .json({ error: "O tamanho total dos anexos não pode passar de 12 MB" });
    const name =
      attachment.name
        .split(/[\\/]/)
        .pop()
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 180) || "anexo";
    validatedAttachments.push({
      name,
      mimeType: match[1],
      dataBase64: match[2],
    });
  }
  const employmentType = ["autonomous", "carrier"].includes(
    driverData.employmentType,
  )
    ? driverData.employmentType
    : "autonomous";
  const carrierId =
    typeof driverData.carrierId === "string" ? driverData.carrierId.trim() : "";
  if (!email || !fullName || !phone || password.length < 6)
    return response.status(400).json({
      error:
        requestedRole === "carrier"
          ? "Nome do sócio representante, e-mail, telefone e senha válida são obrigatórios"
          : "Nome, e-mail, telefone e senha válida são obrigatórios",
    });
  if (!emailPattern.test(email))
    return response.status(400).json({
      error: "Informe um e-mail válido e existente para o cadastro",
    });
  const birthDate = normalizeBirthDate(request.body?.birthDate);
  if (!birthDate)
    return response
      .status(400)
      .json({ error: "Informe uma data de nascimento válida" });
  if (
    ["carrier", "client"].includes(requestedRole) &&
    (!legalName || !cnpj || !address)
  )
    return response.status(400).json({
      error:
        requestedRole === "client"
          ? "Nome da empresa, CNPJ e endereço são obrigatórios para cliente"
          : "Razão social, CNPJ e endereço são obrigatórios para transportadora",
    });
  if (
    requestedRole === "driver" &&
    [
      driverData.cpf,
      driverData.cnh,
      driverData.cnhCategory,
      driverData.cnhExpiresAt,
      driverData.city,
      driverData.state,
      driverData.vehicleModel,
      driverData.vehicleYear,
      driverData.plate,
      driverData.capacity,
      driverData.compartments,
    ].some(
      (value) =>
        value === undefined || value === null || String(value).trim() === "",
    )
  )
    return response.status(400).json({
      error:
        "CPF, CNH, categoria, validade, cidade, UF e veículo completo são obrigatórios para motorista",
    });
  if (requestedRole === "driver" && employmentType === "carrier" && !carrierId)
    return response
      .status(400)
      .json({ error: "Selecione a transportadora do motorista" });
  try {
    const carrier = carrierId
      ? await prisma.transportCompany.findUnique({ where: { id: carrierId } })
      : null;
    if (requestedRole === "driver" && employmentType === "carrier" && !carrier)
      return response
        .status(400)
        .json({ error: "A transportadora selecionada não está disponível" });
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email,
          fullName,
          phone,
          birthDate,
          passwordHash,
          profile: {
            create: {
              fullName,
              role: requestedRole,
              requestedRole,
              registrationNotes,
              approved: false,
            },
          },
          ...(requestedRole === "driver"
            ? {
                driver: {
                  create: {
                    fullName,
                    email,
                    phone,
                    cpf: normalizeDocument(driverData.cpf),
                    vehicleModel: driverData.vehicleModel?.trim() || null,
                    vehicleYear: Number.isInteger(driverData.vehicleYear)
                      ? driverData.vehicleYear
                      : null,
                    capacity: driverData.capacity?.trim() || null,
                    compartments: driverData.compartments?.trim() || null,
                    plate: driverData.plate?.trim() || null,
                    cnh: normalizeDocument(driverData.cnh),
                    cnhCategory: driverData.cnhCategory?.trim() || null,
                    cnhExpiresAt: driverData.cnhExpiresAt
                      ? new Date(driverData.cnhExpiresAt)
                      : null,
                    city: driverData.city?.trim() || null,
                    state: driverData.state?.trim() || null,
                    locationSharingAuthorized:
                      driverData.locationSharingAuthorized === true,
                    employmentType,
                    homologationStatus: "in_analysis",
                  },
                },
              }
            : {}),
        },
      });
      if (requestedRole === "driver" && carrier) {
        const driver = await transaction.driver.findUnique({
          where: { userId: user.id },
        });
        await transaction.driverCarrierLink.create({
          data: { driverId: driver.id, companyId: carrier.id },
        });
      }
      if (["carrier", "client"].includes(requestedRole)) {
        const company = await transaction.transportCompany.create({
          data: {
            userId: user.id,
            legalName,
            cnpj,
            stateRegistration,
            phone,
            address,
            email,
            status: "in_analysis",
          },
        });
        await transaction.profile.update({
          where: { userId: user.id },
          data: { companyId: company.id },
        });
      }
      if (validatedAttachments.length) {
        await transaction.registrationAttachment.createMany({
          data: validatedAttachments.map((attachment) => ({
            ...attachment,
            userId: user.id,
          })),
        });
      }
    });
    broadcast("registration-created");
    response.status(202).json({
      pending: true,
      message: "Cadastro recebido. Aguarde a aprovação do administrador.",
    });
  } catch (error) {
    if (error?.code === "P2002")
      return response.status(409).json({ error: uniqueConflictMessage(error) });
    response.status(500).json({ error: "Não foi possível criar a conta" });
  }
});

app.get("/api/auth/me", auth, (request, response) =>
  response.json({
    user: publicUser(request.user),
    profile: request.user.profile,
  }),
);

app.post("/api/account/change-requests", auth, async (request, response) => {
  const requestedChanges =
    typeof request.body?.requestedChanges === "string"
      ? request.body.requestedChanges.trim().slice(0, 2000)
      : "";
  if (!requestedChanges)
    return response
      .status(400)
      .json({ error: "Descreva a alteração solicitada" });

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

app.patch("/api/account/birth-date", auth, async (request, response) => {
  const birthDate = normalizeBirthDate(request.body?.birthDate);
  if (!birthDate)
    return response
      .status(400)
      .json({ error: "Informe uma data de nascimento válida" });
  if (request.user.birthDate)
    return response.status(409).json({
      error:
        "A data de nascimento já foi informada. Para alterar, abra um chamado.",
    });
  await prisma.user.update({
    where: { id: request.user.id },
    data: { birthDate },
  });
  response.json({ birth_date: birthDate });
});

app.post("/api/auth/password-reset/request", async (request, response) => {
  const email =
    typeof request.body?.email === "string"
      ? request.body.email.trim().toLowerCase()
      : "";
  const document = normalizeDocument(request.body?.document);
  const birthDate = normalizeBirthDate(request.body?.birthDate);
  if (!emailPattern.test(email) || !document || !birthDate)
    return response.status(400).json({
      error:
        "Informe e-mail, número do documento (CPF ou CNPJ) e data de nascimento válidos",
    });
  const clientIp = request.get("fly-client-ip") || request.ip;
  if (
    resetRequestLimited(`email:${email}`, 5) ||
    resetRequestLimited(`ip:${clientIp}`, 20)
  )
    return response.status(429).json({
      error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    });

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      driver: { select: { cpf: true } },
      transportCompany: { select: { cnpj: true } },
    },
  });
  // Motorista confirma com o CPF; transportadora/cliente com o CNPJ. Resposta única para qualquer falha.
  const storedDocument = normalizeDocument(
    user?.driver?.cpf ?? user?.transportCompany?.cnpj,
  );
  const confirmed =
    Boolean(user?.birthDate) &&
    Boolean(storedDocument) &&
    sameSecret(storedDocument, document) &&
    sameSecret(user.birthDate, birthDate);
  if (!confirmed)
    return response.status(403).json({
      error:
        "Os dados informados não conferem. Se o problema continuar, peça ao administrador para redefinir sua senha.",
    });

  const rawToken = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id, usedAt: null },
  });
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  response.json({ reset_token: rawToken });
});

app.post("/api/auth/password-reset/confirm", async (request, response) => {
  const token =
    typeof request.body?.token === "string" ? request.body.token : "";
  const password =
    typeof request.body?.password === "string" ? request.body.password : "";
  if (!token || password.length < 6)
    return response
      .status(400)
      .json({ error: "Token e senha válida são obrigatórios" });

  const reset = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
  });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date())
    return response
      .status(400)
      .json({ error: "Código de recuperação inválido ou expirado" });

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    }),
  ]);
  response.json({
    message: "Senha redefinida com segurança. Faça login novamente.",
  });
});

const requireAdmin = (request, response, next) => {
  if (request.user.profile?.role !== "admin")
    return response
      .status(403)
      .json({ error: "Acesso restrito ao administrador" });
  next();
};

const requireOperations = (request, response, next) => {
  if (!["admin", "operator"].includes(request.user.profile?.role))
    return response.status(403).json({ error: "Acesso não permitido" });
  next();
};

const requireSuperAdmin = (request, response, next) => {
  if (request.user.profile?.isSuperAdmin === true) return next();
  return response
    .status(403)
    .json({ error: "Acesso restrito ao superadministrador" });
};

// ---------------------------------------------------------------------------
// Chamados de suporte: qualquer usuario logado abre; admin/operador atendem.
// ---------------------------------------------------------------------------
const supportTicketStatuses = ["open", "in_progress", "resolved", "closed"];
const supportAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const parseSupportAttachments = (list) => {
  if (!Array.isArray(list)) return { files: [] };
  if (list.length > 5) return { error: "Anexe no m\u00e1ximo 5 prints" };
  const files = [];
  let totalBytes = 0;
  for (const item of list) {
    if (typeof item?.data !== "string" || typeof item?.name !== "string")
      return { error: "Um dos prints \u00e9 inv\u00e1lido" };
    const match = item.data.match(
      /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/,
    );
    if (!match || !supportAttachmentTypes.has(match[1]))
      return { error: "Use imagens JPG, PNG ou WebP" };
    const buffer = Buffer.from(match[2], "base64");
    const validSignature =
      (match[1] === "image/jpeg" &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff) ||
      (match[1] === "image/png" &&
        buffer
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          )) ||
      (match[1] === "image/webp" &&
        buffer.subarray(0, 4).toString() === "RIFF" &&
        buffer.subarray(8, 12).toString() === "WEBP");
    if (
      buffer.toString("base64") !== match[2] ||
      !validSignature ||
      buffer.length > 5 * 1024 * 1024
    )
      return {
        error: "Cada print deve ser uma imagem v\u00e1lida de at\u00e9 5 MB",
      };
    totalBytes += buffer.length;
    if (totalBytes > 12 * 1024 * 1024)
      return {
        error: "O tamanho total dos prints n\u00e3o pode passar de 12 MB",
      };
    files.push({
      name:
        item.name
          .split(/[\\/]/)
          .pop()
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .slice(0, 180) || "print",
      mimeType: match[1],
      dataBase64: match[2],
    });
  }
  return { files };
};

const supportTicketInclude = {
  attachments: {
    select: { id: true, name: true, mimeType: true },
    orderBy: { createdAt: "asc" },
  },
};

const publicSupportTicket = (ticket) => ({
  id: ticket.id,
  subject: ticket.subject,
  description: ticket.description,
  location: ticket.location,
  page_url: ticket.pageUrl,
  status: ticket.status,
  staff_note: ticket.staffNote,
  escalated_at: ticket.escalatedAt?.toISOString() ?? null,
  escalated_by: ticket.escalatedByName ?? null,
  escalation_note: ticket.escalationNote ?? null,
  response_saved:
    Boolean(ticket.responseStatus) && ticket.responseStatus === ticket.status,
  created_at: ticket.createdAt.toISOString(),
  updated_at: ticket.updatedAt.toISOString(),
  attachments: (ticket.attachments || []).map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mime_type: attachment.mimeType,
  })),
  ...(ticket.user
    ? {
        user: {
          id: ticket.user.id,
          full_name: ticket.user.fullName,
          email: ticket.user.email,
          phone: ticket.user.phone,
          role: ticket.user.profile?.role ?? null,
        },
      }
    : {}),
});

const optionalText = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

app.post("/api/support/tickets", auth, async (request, response) => {
  const subject = optionalText(request.body?.subject, 120);
  const description = optionalText(request.body?.description, 4000);
  if (subject.length < 3)
    return response
      .status(400)
      .json({ error: "Informe um t\u00edtulo para o chamado" });
  if (description.length < 10)
    return response.status(400).json({
      error: "Descreva o que est\u00e1 acontecendo (m\u00ednimo 10 caracteres)",
    });
  const parsed = parseSupportAttachments(request.body?.attachments);
  if (parsed.error) return response.status(400).json({ error: parsed.error });
  const recentTickets = await prisma.supportTicket.count({
    where: {
      userId: request.user.id,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  if (recentTickets >= 10)
    return response.status(429).json({
      error:
        "Muitos chamados em pouco tempo. Aguarde um pouco para abrir outro.",
    });
  const ticket = await prisma.supportTicket.create({
    data: {
      userId: request.user.id,
      subject,
      description,
      location: optionalText(request.body?.location, 200) || null,
      pageUrl: optionalText(request.body?.pageUrl, 500) || null,
      userAgent: (request.get("user-agent") || "").slice(0, 300) || null,
      attachments: { create: parsed.files },
    },
    include: supportTicketInclude,
  });
  broadcast("support-ticket-created");
  response.status(201).json({ ticket: publicSupportTicket(ticket) });
});

app.get("/api/support/tickets", auth, async (request, response) => {
  const tickets = await prisma.supportTicket.findMany({
    where: { userId: request.user.id },
    include: supportTicketInclude,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  response.json({ tickets: tickets.map(publicSupportTicket) });
});

app.get(
  "/api/support/tickets/:ticketId/attachments/:attachmentId",
  auth,
  async (request, response) => {
    const isStaff = request.user.profile?.role === "admin";
    const attachment = await prisma.supportTicketAttachment.findFirst({
      where: {
        id: request.params.attachmentId,
        ticketId: request.params.ticketId,
        ...(isStaff ? {} : { ticket: { userId: request.user.id } }),
      },
    });
    if (!attachment)
      return response.status(404).json({ error: "Print n\u00e3o encontrado" });
    response.setHeader("Content-Type", attachment.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(Buffer.from(attachment.dataBase64, "base64"));
  },
);

// Chamados chegam aos administradores (motoristas, operadores e demais perfis).
// Chamados de operadores podem ser repassados pelo administrador ao super administrador.
const supportOriginFilters = {
  drivers: { user: { profile: { role: "driver" } } },
  operators: { user: { profile: { role: "operator" } } },
  others: { user: { profile: { role: { notIn: ["driver", "operator"] } } } },
  escalated: { escalatedAt: { not: null } },
};

app.get(
  "/api/admin/support/tickets",
  auth,
  requireAdmin,
  async (request, response) => {
    const status = supportTicketStatuses.includes(request.query.status)
      ? request.query.status
      : undefined;
    const originFilter = Object.prototype.hasOwnProperty.call(
      supportOriginFilters,
      request.query.origin,
    )
      ? supportOriginFilters[request.query.origin]
      : {};
    const [tickets, grouped, escalatedOpen] = await Promise.all([
      prisma.supportTicket.findMany({
        where: { ...originFilter, ...(status ? { status } : {}) },
        include: {
          ...supportTicketInclude,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              profile: { select: { role: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.supportTicket.count({
        where: {
          escalatedAt: { not: null },
          status: { in: ["open", "in_progress"] },
        },
      }),
    ]);
    response.json({
      tickets: tickets.map(publicSupportTicket),
      counts: Object.fromEntries(
        grouped.map((item) => [item.status, item._count._all]),
      ),
      escalated_open: escalatedOpen,
    });
  },
);

app.post(
  "/api/admin/support/tickets/:ticketId/escalate",
  auth,
  requireAdmin,
  async (request, response) => {
    if (request.user.profile?.isSuperAdmin === true)
      return response.status(403).json({
        error: "O super administrador é quem recebe os chamados repassados",
      });
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: request.params.ticketId },
      include: { user: { select: { profile: { select: { role: true } } } } },
    });
    if (!ticket)
      return response.status(404).json({ error: "Chamado não encontrado" });
    if (ticket.user.profile?.role !== "operator")
      return response.status(400).json({
        error:
          "Só chamados de operadores podem ser repassados ao super administrador",
      });
    if (ticket.escalatedAt)
      return response
        .status(409)
        .json({ error: "Este chamado já foi repassado" });
    if (ticket.status === "resolved")
      return response.status(409).json({
        error: "Chamado resolvido: não pode mais ser alterado ou repassado",
      });
    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        escalatedAt: new Date(),
        escalatedByName:
          request.user.fullName || request.user.email || "Administrador",
        escalationNote: optionalText(request.body?.note, 1000) || null,
        status: ticket.status === "open" ? "in_progress" : ticket.status,
      },
      include: supportTicketInclude,
    });
    broadcast("support-ticket-escalated");
    response.json({ ticket: publicSupportTicket(updated) });
  },
);

app.patch(
  "/api/admin/support/tickets/:ticketId",
  auth,
  requireAdmin,
  async (request, response) => {
    const data = {};
    if (request.body?.status !== undefined) {
      if (!supportTicketStatuses.includes(request.body.status))
        return response.status(400).json({ error: "Status inv\u00e1lido" });
      data.status = request.body.status;
    }
    if (request.body?.staffNote !== undefined)
      data.staffNote = optionalText(request.body.staffNote, 2000) || null;
    if (!Object.keys(data).length)
      return response.status(400).json({ error: "Nada para atualizar" });
    const existing = await prisma.supportTicket.findUnique({
      where: { id: request.params.ticketId },
      select: {
        id: true,
        userId: true,
        escalatedAt: true,
        status: true,
        responseStatus: true,
      },
    });
    if (!existing)
      return response
        .status(404)
        .json({ error: "Chamado n\u00e3o encontrado" });
    if (existing.escalatedAt && request.user.profile?.isSuperAdmin !== true)
      return response.status(403).json({
        error:
          "Chamado repassado: s\u00f3 o super administrador pode atualiz\u00e1-lo",
      });
    if (existing.status === "resolved")
      return response.status(409).json({
        error: "Chamado resolvido: não pode mais ser alterado",
      });
    // A resposta só pode ser salva de novo depois que o status mudar.
    const statusChanged =
      data.status !== undefined && data.status !== existing.status;
    if (data.staffNote !== undefined) {
      if (!statusChanged && existing.responseStatus === existing.status)
        return response.status(409).json({
          error:
            "A resposta já foi salva. Altere o status do chamado para enviar outra.",
        });
      data.responseStatus = data.status ?? existing.status;
    } else if (statusChanged) data.responseStatus = null;
    const ticket = await prisma.supportTicket.update({
      where: { id: existing.id },
      data,
      include: supportTicketInclude,
    });
    broadcast("support-ticket-updated", existing.userId);
    response.json({ ticket: publicSupportTicket(ticket) });
  },
);

const superAdminDataModels = {
  User: {
    delegate: "user",
    label: "Usuários",
    keyFields: ["id"],
    fields: {
      id: "ID",
      email: "E-mail",
      fullName: "Nome",
      phone: "Telefone",
      role: "Perfil",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      createdAt: true,
      profile: { select: { role: true, isSuperAdmin: true } },
    },
  },
  Profile: {
    delegate: "profile",
    label: "Perfis de acesso",
    keyFields: ["id"],
    fields: {
      id: "ID",
      userId: "Usuário",
      role: "Perfil",
      fullName: "Nome",
      approved: "Aprovado",
      isSuperAdmin: "Superadmin",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      userId: true,
      role: true,
      fullName: true,
      approved: true,
      isSuperAdmin: true,
      createdAt: true,
    },
  },
  RegistrationAttachment: {
    delegate: "registrationAttachment",
    label: "Anexos de cadastro",
    keyFields: ["id"],
    fields: {
      id: "ID",
      userId: "Usuário",
      name: "Arquivo",
      mimeType: "Tipo",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      userId: true,
      name: true,
      mimeType: true,
      createdAt: true,
    },
  },
  Driver: {
    delegate: "driver",
    label: "Motoristas",
    keyFields: ["id"],
    fields: {
      id: "ID",
      fullName: "Nome",
      email: "E-mail",
      phone: "Telefone",
      plate: "Placa",
      status: "Status",
      homologationStatus: "Homologação",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      plate: true,
      status: true,
      homologationStatus: true,
      createdAt: true,
    },
  },
  DriverChatMessage: {
    delegate: "driverChatMessage",
    label: "Mensagens do chat",
    keyFields: ["id"],
    fields: {
      id: "ID",
      driverId: "Motorista",
      userId: "Remetente",
      body: "Mensagem",
      createdAt: "Enviada em",
      freightOfferId: "Oferta",
    },
    select: {
      id: true,
      driverId: true,
      userId: true,
      body: true,
      createdAt: true,
      freightOfferId: true,
    },
  },
  OperationalLocation: {
    delegate: "operationalLocation",
    label: "Locais operacionais",
    keyFields: ["id"],
    fields: {
      id: "ID",
      kind: "Tipo",
      name: "Nome",
      city: "Cidade",
      state: "UF",
      active: "Ativo",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      kind: true,
      name: true,
      city: true,
      state: true,
      active: true,
      createdAt: true,
    },
  },
  OperationalLocationCompanyAccess: {
    delegate: "operationalLocationCompanyAccess",
    label: "Acessos de empresas a locais",
    keyFields: ["locationId", "companyId"],
    compoundKey: "locationId_companyId",
    fields: {
      locationId: "Local",
      companyId: "Empresa",
      createdAt: "Criado em",
    },
    select: { locationId: true, companyId: true, createdAt: true },
  },
  AccountChangeRequest: {
    delegate: "accountChangeRequest",
    label: "Solicitações de alteração de conta",
    keyFields: ["id"],
    fields: {
      id: "ID",
      userId: "Usuário",
      status: "Status",
      createdAt: "Criado em",
      updatedAt: "Atualizado em",
    },
    select: {
      id: true,
      userId: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  PasswordResetToken: {
    delegate: "passwordResetToken",
    label: "Tokens de recuperação",
    keyFields: ["id"],
    fields: {
      id: "ID",
      userId: "Usuário",
      expiresAt: "Expira em",
      usedAt: "Usado em",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      createdAt: true,
    },
  },
  TransportCompany: {
    delegate: "transportCompany",
    label: "Transportadoras",
    keyFields: ["id"],
    fields: {
      id: "ID",
      legalName: "Razão social",
      cnpj: "CNPJ",
      email: "E-mail",
      status: "Status",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      legalName: true,
      cnpj: true,
      email: true,
      status: true,
      createdAt: true,
    },
  },
  Vehicle: {
    delegate: "vehicle",
    label: "Veículos",
    keyFields: ["id"],
    fields: {
      id: "ID",
      type: "Tipo",
      plate: "Placa",
      companyId: "Transportadora",
      ownerDriverId: "Proprietário",
      homologationStatus: "Homologação",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      type: true,
      plate: true,
      companyId: true,
      ownerDriverId: true,
      homologationStatus: true,
      createdAt: true,
    },
  },
  VehicleDriverAssignment: {
    delegate: "vehicleDriverAssignment",
    label: "Vínculos de veículos e motoristas",
    keyFields: ["id"],
    fields: {
      id: "ID",
      vehicleId: "Veículo",
      driverId: "Motorista",
      status: "Status",
      startedAt: "Início",
      endedAt: "Fim",
    },
    select: {
      id: true,
      vehicleId: true,
      driverId: true,
      status: true,
      startedAt: true,
      endedAt: true,
    },
  },
  DriverCarrierLink: {
    delegate: "driverCarrierLink",
    label: "Vínculos de motoristas e transportadoras",
    keyFields: ["id"],
    fields: {
      id: "ID",
      driverId: "Motorista",
      companyId: "Transportadora",
      status: "Status",
      startedAt: "Início",
      endedAt: "Fim",
    },
    select: {
      id: true,
      driverId: true,
      companyId: true,
      status: true,
      startedAt: true,
      endedAt: true,
    },
  },
  VehicleProduct: {
    delegate: "vehicleProduct",
    label: "Produtos de veículos",
    keyFields: ["id"],
    fields: {
      id: "ID",
      vehicleId: "Veículo",
      product: "Produto",
      enabled: "Ativo",
      createdAt: "Criado em",
    },
    select: {
      id: true,
      vehicleId: true,
      product: true,
      enabled: true,
      createdAt: true,
    },
  },
  HomologationDocument: {
    delegate: "homologationDocument",
    label: "Documentos de homologação",
    keyFields: ["id"],
    fields: {
      id: "ID",
      driverId: "Motorista",
      vehicleId: "Veículo",
      companyId: "Transportadora",
      documentType: "Documento",
      fileName: "Arquivo",
      status: "Status",
      expiresAt: "Expira em",
    },
    select: {
      id: true,
      driverId: true,
      vehicleId: true,
      companyId: true,
      documentType: true,
      fileName: true,
      status: true,
      expiresAt: true,
    },
  },
  FreightRoute: {
    delegate: "freightRoute",
    label: "Rotas de frete",
    keyFields: ["id"],
    fields: {
      id: "ID",
      createdByUserId: "Criada por",
      collectionPointId: "Coleta",
      finalCustomerId: "Destino",
      distanceKm: "Distância (km)",
      status: "Status",
      createdAt: "Criada em",
    },
    select: {
      id: true,
      createdByUserId: true,
      collectionPointId: true,
      finalCustomerId: true,
      distanceKm: true,
      status: true,
      createdAt: true,
    },
  },
  FreightRouteAssignment: {
    delegate: "freightRouteAssignment",
    label: "Atribuições de frete",
    keyFields: ["id"],
    fields: {
      id: "ID",
      routeId: "Rota",
      driverId: "Motorista",
      status: "Status",
      acceptedAt: "Aceita em",
      endedAt: "Encerrada em",
    },
    select: {
      id: true,
      routeId: true,
      driverId: true,
      status: true,
      acceptedAt: true,
      endedAt: true,
    },
  },
  FreightChatOffer: {
    delegate: "freightChatOffer",
    label: "Ofertas de frete do chat",
    keyFields: ["id"],
    fields: {
      id: "ID",
      routeId: "Rota",
      driverId: "Motorista",
      amountCents: "Valor (centavos)",
      status: "Status",
      createdAt: "Criada em",
      respondedAt: "Respondida em",
    },
    select: {
      id: true,
      routeId: true,
      driverId: true,
      amountCents: true,
      status: true,
      createdAt: true,
      respondedAt: true,
    },
  },
  FreightSettlement: {
    delegate: "freightSettlement",
    label: "Recebimentos de fretes",
    keyFields: ["id"],
    fields: {
      id: "ID",
      assignmentId: "Atribuição",
      driverClaimedAmountCents: "Solicitado (centavos)",
      confirmedAmountCents: "Confirmado (centavos)",
      status: "Status",
      paymentReference: "Referência",
      paidAt: "Pago em",
    },
    select: {
      id: true,
      assignmentId: true,
      driverClaimedAmountCents: true,
      confirmedAmountCents: true,
      status: true,
      paymentReference: true,
      paidAt: true,
    },
  },
};

const resolveSuperAdminDataModel = (name) =>
  Object.prototype.hasOwnProperty.call(superAdminDataModels, name)
    ? superAdminDataModels[name]
    : null;

const superAdminDeletableWhere = async (name, request) => {
  if (name === "User") {
    const protectedProfiles = await prisma.profile.findMany({
      where: { isSuperAdmin: true },
      select: { userId: true },
    });
    const protectedUserIds = new Set([
      request.user.id,
      ...protectedProfiles.map((profile) => profile.userId),
    ]);
    return { id: { notIn: [...protectedUserIds] } };
  }
  if (name === "Profile")
    return { isSuperAdmin: false, userId: { not: request.user.id } };
  return {};
};

const superAdminRecordIsProtected = (name, record, request) =>
  (name === "User" &&
    (record.id === request.user.id || record.profile?.isSuperAdmin === true)) ||
  (name === "Profile" &&
    (record.userId === request.user.id || record.isSuperAdmin === true));

const publicSuperAdminRecord = (name, model, record, request) => {
  const values = Object.fromEntries(
    Object.keys(model.fields).map((field) => [field, record[field] ?? null]),
  );
  if (name === "User") {
    values.role = record.profile?.role ?? "Sem perfil";
    values.isSuperAdmin = record.profile?.isSuperAdmin === true;
  }
  return {
    key: Object.fromEntries(
      model.keyFields.map((field) => [field, record[field]]),
    ),
    protected: superAdminRecordIsProtected(name, record, request),
    values,
  };
};

app.get(
  "/api/superadmin/data/models",
  auth,
  requireSuperAdmin,
  async (request, response) => {
    const models = await Promise.all(
      Object.entries(superAdminDataModels).map(async ([name, model]) => {
        const where = await superAdminDeletableWhere(name, request);
        const delegate = prisma[model.delegate];
        const [totalRecords, deletableRecords] = await Promise.all([
          delegate.count(),
          delegate.count({ where }),
        ]);
        return {
          name,
          label: model.label,
          fields: model.fields,
          keyFields: model.keyFields,
          totalRecords,
          deletableRecords,
          protectedRecords: totalRecords - deletableRecords,
        };
      }),
    );
    response.json({ models });
  },
);

app.get(
  "/api/superadmin/data/models/:model",
  auth,
  requireSuperAdmin,
  async (request, response) => {
    const model = resolveSuperAdminDataModel(request.params.model);
    if (!model)
      return response.status(404).json({ error: "Modelo não encontrado" });
    const requestedPage = Number.parseInt(request.query.page, 10);
    const page =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
    const pageSize = 50;
    const delegate = prisma[model.delegate];
    const [records, totalRecords] = await Promise.all([
      delegate.findMany({
        select: model.select,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      delegate.count(),
    ]);
    response.json({
      records: records.map((record) =>
        publicSuperAdminRecord(request.params.model, model, record, request),
      ),
      page,
      pageSize,
      totalRecords,
      totalPages: Math.max(1, Math.ceil(totalRecords / pageSize)),
    });
  },
);

app.delete(
  "/api/superadmin/data/models/:model/records",
  auth,
  requireSuperAdmin,
  async (request, response) => {
    const model = resolveSuperAdminDataModel(request.params.model);
    if (!model)
      return response.status(404).json({ error: "Modelo não encontrado" });
    const key = request.body?.key;
    if (
      !key ||
      typeof key !== "object" ||
      !model.keyFields.every(
        (field) => typeof key[field] === "string" && key[field].length > 0,
      )
    )
      return response.status(400).json({ error: "Identificador inválido" });

    const where =
      model.keyFields.length === 1
        ? { [model.keyFields[0]]: key[model.keyFields[0]] }
        : {
            [model.compoundKey]: Object.fromEntries(
              model.keyFields.map((field) => [field, key[field]]),
            ),
          };
    const delegate = prisma[model.delegate];
    const record = await delegate.findUnique({
      where,
      select: model.select,
    });
    if (!record)
      return response.status(404).json({ error: "Registro não encontrado" });
    if (superAdminRecordIsProtected(request.params.model, record, request))
      return response.status(403).json({
        error: "Não é permitido apagar uma conta superadmin ou a própria conta",
      });

    try {
      await delegate.delete({
        where,
        select: Object.fromEntries(
          model.keyFields.map((field) => [field, true]),
        ),
      });
    } catch (error) {
      if (["P2003", "P2014"].includes(error?.code))
        return response.status(409).json({
          error:
            "Este registro possui dependências que impedem a exclusão. Apague os registros relacionados primeiro.",
        });
      if (error?.code === "P2025")
        return response.status(404).json({ error: "Registro não encontrado" });
      throw error;
    }
    console.warn(
      `Superadmin ${request.user.id} deleted ${request.params.model} record ${JSON.stringify(key)}`,
    );
    response.json({ deleted: true });
  },
);

app.delete(
  "/api/superadmin/data/models/:model",
  auth,
  requireSuperAdmin,
  async (request, response) => {
    const model = resolveSuperAdminDataModel(request.params.model);
    if (!model)
      return response.status(404).json({ error: "Modelo não encontrado" });
    if (request.body?.confirmation !== "ZERAR")
      return response.status(400).json({
        error: "Confirme a limpeza digitando ZERAR",
      });
    const where = await superAdminDeletableWhere(request.params.model, request);
    const delegate = prisma[model.delegate];
    const deletableRecords = await delegate.count({ where });
    if (!deletableRecords)
      return response.status(409).json({
        error: "Não há registros apagáveis neste modelo",
      });
    try {
      const result = await prisma.$transaction((transaction) =>
        transaction[model.delegate].deleteMany({ where }),
      );
      console.warn(
        `Superadmin ${request.user.id} cleared ${request.params.model}: ${result.count} records`,
      );
      response.json({ deletedCount: result.count });
    } catch (error) {
      if (["P2003", "P2014"].includes(error?.code))
        return response.status(409).json({
          error:
            "A limpeza foi cancelada porque há dependências restritas. Apague ou limpe os modelos relacionados primeiro.",
        });
      throw error;
    }
  },
);

const requireCarrier = (request, response, next) => {
  if (
    request.user.profile?.role !== "carrier" ||
    !request.user.profile.companyId
  )
    return response
      .status(403)
      .json({ error: "Acesso restrito à transportadora" });
  next();
};

app.post("/api/admin/users", auth, requireAdmin, async (request, response) => {
  const fullName =
    typeof request.body?.fullName === "string"
      ? request.body.fullName.trim()
      : "";
  const email =
    typeof request.body?.email === "string"
      ? request.body.email.trim().toLowerCase()
      : "";
  const phone =
    typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const role = ["operator", "admin"].includes(request.body?.role)
    ? request.body.role
    : null;
  const initialPassword =
    typeof request.body?.initialPassword === "string"
      ? request.body.initialPassword
      : "";
  if (!fullName || !email || !role || initialPassword.length < 8)
    return response.status(400).json({
      error: "Nome, e-mail, perfil e senha inicial válida são obrigatórios",
    });
  try {
    const passwordHash = await hashPassword(initialPassword);
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        phone: phone || null,
        passwordHash,
        profile: {
          create: {
            fullName,
            role,
            requestedRole: role,
            approved: true,
            mustChangePassword: true,
          },
        },
      },
      include: { profile: true },
    });
    broadcast("admin-user-created");
    response
      .status(201)
      .json({ user: publicUser(user), profile: user.profile });
  } catch (error) {
    if (error?.code === "P2002")
      return response.status(409).json({ error: uniqueConflictMessage(error) });
    response.status(400).json({ error: "Não foi possível criar o acesso" });
  }
});

app.patch(
  "/api/admin/users/:userId/password",
  auth,
  requireSuperAdmin,
  async (request, response) => {
    const password =
      typeof request.body?.password === "string" ? request.body.password : "";
    if (password.length < 8)
      return response
        .status(400)
        .json({ error: "A senha deve ter no mínimo 8 caracteres" });

    const user = await prisma.user.findUnique({
      where: { id: request.params.userId },
      include: { profile: true },
    });
    if (!user?.profile)
      return response.status(404).json({ error: "Usuário não encontrado" });

    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.profile.update({
        where: { userId: user.id },
        data: { mustChangePassword: true },
      }),
    ]);
    broadcast("user-password-updated");
    response.json({ updated: true });
  },
);

app.get(
  "/api/admin/pending-users",
  auth,
  requireOperations,
  async (_request, response) => {
    const isOperator = _request.user.profile?.role === "operator";
    const profiles = await prisma.profile.findMany({
      where: {
        approved: false,
        approvalClosed: false,
        ...(isOperator
          ? { requestedRole: { in: ["driver", "carrier", "client"] } }
          : {}),
      },
      include: {
        user: {
          include: {
            driver: {
              include: {
                carrierLinks: {
                  where: { endedAt: null },
                  include: { company: true },
                  take: 1,
                },
              },
            },
            registrationAttachments: {
              select: { id: true, name: true, mimeType: true },
            },
          },
        },
        company: true,
      },
      orderBy: { createdAt: "asc" },
    });
    response.json({
      users: profiles.map((profile) => ({
        id: profile.userId,
        profile_id: profile.id,
        full_name: profile.fullName,
        email: profile.user.email,
        phone: profile.user.phone,
        birth_date: profile.user.birthDate ?? null,
        role: profile.role,
        requested_role: profile.requestedRole,
        company_id: profile.companyId,
        company: profile.company
          ? {
              legal_name: profile.company.legalName,
              cnpj: profile.company.cnpj,
              state_registration: profile.company.stateRegistration,
              phone: profile.company.phone,
              address: profile.company.address,
              email: profile.company.email,
              status: profile.company.status,
            }
          : null,
        registration_notes: profile.registrationNotes,
        attachments: profile.user.registrationAttachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mime_type: attachment.mimeType,
        })),
        driver: profile.user.driver
          ? {
              full_name: profile.user.driver.fullName,
              phone: profile.user.driver.phone,
              cpf: profile.user.driver.cpf,
              cnh: profile.user.driver.cnh,
              cnh_category: profile.user.driver.cnhCategory,
              cnh_expires_at:
                profile.user.driver.cnhExpiresAt?.toISOString() || "",
              vehicle_model: profile.user.driver.vehicleModel,
              plate: profile.user.driver.plate,
              vehicle_year: profile.user.driver.vehicleYear,
              city: profile.user.driver.city,
              state: profile.user.driver.state,
              capacity: profile.user.driver.capacity,
              compartments: profile.user.driver.compartments,
              employment_type: profile.user.driver.employmentType,
              carrier: profile.user.driver.carrierLinks?.[0]?.company
                ? publicCompany(profile.user.driver.carrierLinks[0].company)
                : null,
              location_sharing_authorized:
                profile.user.driver.locationSharingAuthorized,
            }
          : null,
        created_at: profile.createdAt.toISOString(),
      })),
    });
  },
);

app.get(
  "/api/admin/registration-requests",
  auth,
  requireAdmin,
  async (_request, response) => {
    const profiles = await prisma.profile.findMany({
      where: { approved: false },
      include: {
        user: {
          include: {
            driver: {
              include: {
                carrierLinks: {
                  where: { endedAt: null },
                  include: { company: true },
                  take: 1,
                },
              },
            },
            registrationAttachments: {
              select: { id: true, name: true, mimeType: true },
            },
          },
        },
        company: true,
      },
      orderBy: { createdAt: "desc" },
    });
    response.json({
      users: profiles.map((profile) => ({
        id: profile.userId,
        profile_id: profile.id,
        full_name: profile.fullName,
        email: profile.user.email,
        phone: profile.user.phone,
        birth_date: profile.user.birthDate ?? null,
        role: profile.role,
        requested_role: profile.requestedRole,
        registration_notes: profile.registrationNotes,
        attachments: profile.user.registrationAttachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mime_type: attachment.mimeType,
        })),
        company_id: profile.companyId,
        company: profile.company
          ? {
              legal_name: profile.company.legalName,
              cnpj: profile.company.cnpj,
              state_registration: profile.company.stateRegistration,
              phone: profile.company.phone,
              address: profile.company.address,
              email: profile.company.email,
              status: profile.company.status,
            }
          : null,
        driver: profile.user.driver
          ? {
              full_name: profile.user.driver.fullName,
              phone: profile.user.driver.phone,
              cpf: profile.user.driver.cpf,
              cnh: profile.user.driver.cnh,
              cnh_category: profile.user.driver.cnhCategory,
              cnh_expires_at:
                profile.user.driver.cnhExpiresAt?.toISOString() || "",
              vehicle_model: profile.user.driver.vehicleModel,
              plate: profile.user.driver.plate,
              vehicle_year: profile.user.driver.vehicleYear,
              city: profile.user.driver.city,
              state: profile.user.driver.state,
              capacity: profile.user.driver.capacity,
              compartments: profile.user.driver.compartments,
              employment_type: profile.user.driver.employmentType,
              carrier: profile.user.driver.carrierLinks?.[0]?.company
                ? publicCompany(profile.user.driver.carrierLinks[0].company)
                : null,
              location_sharing_authorized:
                profile.user.driver.locationSharingAuthorized,
            }
          : null,
        approval_closed: profile.approvalClosed,
        created_at: profile.createdAt.toISOString(),
      })),
    });
  },
);

app.get(
  "/api/admin/registration-requests/:userId/attachments/:attachmentId",
  auth,
  requireOperations,
  async (request, response) => {
    const profile = await prisma.profile.findFirst({
      where: {
        userId: request.params.userId,
        approved: false,
        ...(request.user.profile?.role === "operator"
          ? {
              approvalClosed: false,
              requestedRole: { in: ["driver", "carrier", "client"] },
            }
          : {}),
      },
      select: { userId: true },
    });
    if (!profile)
      return response.status(404).json({ error: "Solicitação não encontrada" });
    const attachment = await prisma.registrationAttachment.findFirst({
      where: { id: request.params.attachmentId, userId: profile.userId },
    });
    if (!attachment)
      return response.status(404).json({ error: "Anexo não encontrado" });
    response.setHeader("Content-Type", attachment.mimeType);
    const disposition = request.query.view === "1" ? "inline" : "attachment";
    response.setHeader(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(Buffer.from(attachment.dataBase64, "base64"));
  },
);

app.patch(
  "/api/admin/users/:userId/close-approval",
  auth,
  requireAdmin,
  async (request, response) => {
    const profile = await prisma.profile.updateMany({
      where: { userId: request.params.userId, approved: false },
      data: { approvalClosed: true },
    });
    if (profile.count === 0)
      return response
        .status(404)
        .json({ error: "Solicitação não encontrada ou já aprovada" });
    broadcast("registration-approval-closed");
    response.json({ closed: true });
  },
);

app.patch(
  "/api/admin/users/:userId/reopen-approval",
  auth,
  requireAdmin,
  async (request, response) => {
    const profile = await prisma.profile.updateMany({
      where: { userId: request.params.userId, approved: false },
      data: { approvalClosed: false },
    });
    if (profile.count === 0)
      return response
        .status(404)
        .json({ error: "Solicitação não encontrada ou já aprovada" });
    broadcast("registration-approval-reopened");
    response.json({ reopened: true });
  },
);

app.delete(
  "/api/admin/users/:userId/reject",
  auth,
  requireOperations,
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.userId },
      include: { profile: true, transportCompany: true },
    });
    if (!user?.profile)
      return response.status(404).json({ error: "Solicitação não encontrada" });
    if (user.profile.approved)
      return response.status(400).json({
        error: "Cadastros aprovados não podem ser rejeitados por esta ação",
      });

    await prisma.$transaction(async (transaction) => {
      if (user.transportCompany) {
        await transaction.vehicle.deleteMany({
          where: { companyId: user.transportCompany.id },
        });
        await transaction.transportCompany.delete({
          where: { id: user.transportCompany.id },
        });
      }
      await transaction.user.delete({ where: { id: user.id } });
    });
    broadcast("registration-rejected");
    response.status(204).end();
  },
);

app.delete(
  "/api/admin/users/:userId/remove",
  auth,
  requireAdmin,
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.userId },
      include: { profile: true, transportCompany: true },
    });
    if (!user?.profile)
      return response.status(404).json({ error: "Usuário não encontrado" });
    if (user.profile.role === "admin")
      return response.status(400).json({
        error: "Administradores não podem ser removidos por esta ação",
      });

    await prisma.$transaction(async (transaction) => {
      if (user.transportCompany) {
        await transaction.vehicle.deleteMany({
          where: { companyId: user.transportCompany.id },
        });
        await transaction.transportCompany.delete({
          where: { id: user.transportCompany.id },
        });
      }
      await transaction.user.delete({ where: { id: user.id } });
    });
    broadcast("admin-user-removed");
    response.status(204).end();
  },
);

app.patch(
  "/api/admin/users/:userId/approve",
  auth,
  requireOperations,
  async (request, response) => {
    const assignedRole = [
      "driver",
      "carrier",
      "client",
      "operator",
      "admin",
    ].includes(request.body?.role)
      ? request.body.role
      : null;
    if (!assignedRole)
      return response.status(400).json({ error: "Informe um perfil válido" });
    if (
      request.user.profile?.role === "operator" &&
      !["driver", "carrier", "client"].includes(assignedRole)
    ) {
      return response.status(403).json({
        error:
          "Operadores só podem aprovar motoristas, transportadoras e clientes",
      });
    }
    const user = await prisma.user.findUnique({
      where: { id: request.params.userId },
      include: { profile: true, driver: true, transportCompany: true },
    });
    if (!user?.profile)
      return response.status(404).json({ error: "Cadastro não encontrado" });
    if (user.profile.approvalClosed)
      return response
        .status(400)
        .json({ error: "Reabra a solicitação antes de aprovar" });
    if (!user.fullName?.trim() || !user.email?.trim() || !user.phone?.trim()) {
      return response.status(400).json({
        error: "Nome, e-mail e telefone do cadastro são obrigatórios",
      });
    }
    if (
      ["carrier", "client"].includes(assignedRole) &&
      (!user.transportCompany?.legalName?.trim() ||
        !user.transportCompany.cnpj?.trim() ||
        !user.transportCompany.phone?.trim() ||
        !user.transportCompany.address?.trim() ||
        !user.transportCompany.email?.trim())
    ) {
      return response.status(400).json({
        error:
          assignedRole === "client"
            ? "Confira nome da empresa, CNPJ, telefone, endereço e e-mail do cliente antes de aprovar"
            : "Confira razão social, CNPJ, telefone, endereço e e-mail da transportadora antes de aprovar",
      });
    }
    const driverData = request.body?.driver || {};
    const requiredDriverFields = user.profile.companyId
      ? ["fullName", "phone"]
      : [
          "fullName",
          "phone",
          "cpf",
          "cnh",
          "cnhCategory",
          "cnhExpiresAt",
          "vehicleModel",
          "vehicleYear",
          "plate",
          "city",
          "state",
          "capacity",
          "compartments",
        ];
    if (
      assignedRole === "driver" &&
      requiredDriverFields.some(
        (field) =>
          typeof driverData[field] !== "string" || !driverData[field].trim(),
      )
    ) {
      return response.status(400).json({
        error:
          "Preencha todos os campos obrigatórios do motorista antes de aprovar",
      });
    }
    const initialPassword =
      typeof request.body?.initialPassword === "string"
        ? request.body.initialPassword
        : "";
    if (
      ["operator", "admin"].includes(assignedRole) &&
      initialPassword.length < 8
    ) {
      return response.status(400).json({
        error: "Informe uma senha inicial com no mínimo 8 caracteres",
      });
    }
    const initialPasswordHash = ["operator", "admin"].includes(assignedRole)
      ? await hashPassword(initialPassword)
      : null;
    let profile;
    try {
      profile = await prisma.$transaction(async (transaction) => {
        const updatedProfile = await transaction.profile.update({
          where: { userId: request.params.userId },
          data: {
            approved: true,
            role: assignedRole,
            mustChangePassword: ["operator", "admin"].includes(assignedRole),
          },
        });
        if (
          ["carrier", "client"].includes(assignedRole) &&
          user.transportCompany
        ) {
          await transaction.transportCompany.update({
            where: { id: user.transportCompany.id },
            data: { status: "active" },
          });
        }
        if (initialPasswordHash)
          await transaction.user.update({
            where: { id: user.id },
            data: { passwordHash: initialPasswordHash },
          });
        if (assignedRole === "driver" && !user.driver) {
          const approvedDriver = await transaction.driver.create({
            data: {
              userId: user.id,
              fullName: driverData.fullName.trim(),
              email: user.email,
              phone: driverData.phone.trim(),
              vehicleModel: driverData.vehicleModel?.trim() || null,
              vehicleYear: driverData.vehicleYear
                ? Number(driverData.vehicleYear)
                : null,
              plate: driverData.plate?.trim() || null,
              city: driverData.city?.trim() || null,
              state: driverData.state?.trim() || null,
              capacity: driverData.capacity?.trim() || null,
              compartments: driverData.compartments?.trim() || null,
              cpf: normalizeDocument(driverData.cpf),
              cnh: normalizeDocument(driverData.cnh),
              cnhCategory: driverData.cnhCategory?.trim() || null,
              cnhExpiresAt: driverData.cnhExpiresAt
                ? new Date(driverData.cnhExpiresAt)
                : null,
              locationSharingAuthorized:
                driverData.locationSharingAuthorized === true,
              employmentType: user.profile.companyId ? "carrier" : "autonomous",
              homologationStatus: "active",
            },
          });
          if (user.profile.companyId)
            await transaction.driverCarrierLink.create({
              data: {
                driverId: approvedDriver.id,
                companyId: user.profile.companyId,
              },
            });
        } else if (assignedRole === "driver" && user.driver) {
          await transaction.driver.update({
            where: { id: user.driver.id },
            data: {
              fullName: driverData.fullName.trim(),
              email: user.email,
              phone: driverData.phone.trim(),
              vehicleModel:
                driverData.vehicleModel === undefined
                  ? user.driver.vehicleModel
                  : driverData.vehicleModel.trim() || null,
              vehicleYear:
                driverData.vehicleYear === undefined
                  ? user.driver.vehicleYear
                  : Number(driverData.vehicleYear),
              plate:
                driverData.plate === undefined
                  ? user.driver.plate
                  : driverData.plate.trim() || null,
              city:
                driverData.city === undefined
                  ? user.driver.city
                  : driverData.city.trim() || null,
              state:
                driverData.state === undefined
                  ? user.driver.state
                  : driverData.state.trim() || null,
              capacity:
                driverData.capacity === undefined
                  ? user.driver.capacity
                  : driverData.capacity.trim() || null,
              compartments:
                driverData.compartments === undefined
                  ? user.driver.compartments
                  : driverData.compartments.trim() || null,
              cpf:
                driverData.cpf === undefined
                  ? user.driver.cpf
                  : normalizeDocument(driverData.cpf),
              cnh:
                driverData.cnh === undefined
                  ? user.driver.cnh
                  : normalizeDocument(driverData.cnh),
              cnhCategory:
                driverData.cnhCategory === undefined
                  ? user.driver.cnhCategory
                  : driverData.cnhCategory.trim() || null,
              cnhExpiresAt:
                driverData.cnhExpiresAt === undefined
                  ? user.driver.cnhExpiresAt
                  : driverData.cnhExpiresAt
                    ? new Date(driverData.cnhExpiresAt)
                    : null,
              locationSharingAuthorized:
                driverData.locationSharingAuthorized === undefined
                  ? user.driver.locationSharingAuthorized
                  : driverData.locationSharingAuthorized === true,
              employmentType: user.profile.companyId
                ? "carrier"
                : user.driver.employmentType,
              homologationStatus: "active",
            },
          });
        }
        return updatedProfile;
      });
    } catch (error) {
      if (error?.code === "P2002")
        return response
          .status(409)
          .json({ error: uniqueConflictMessage(error) });
      throw error;
    }
    broadcast("registration-approved");
    response.json({ profile });
  },
);

app.get("/api/drivers/me", auth, async (request, response) => {
  if (!request.user.driver)
    return response
      .status(404)
      .json({ error: "Motorista ainda não cadastrado" });
  response.json({ driver: publicDriver(request.user.driver) });
});

app.patch("/api/drivers/me", auth, async (request, response) => {
  if (!request.user.driver)
    return response
      .status(404)
      .json({ error: "Motorista ainda não cadastrado" });
  const body = request.body || {};
  const allowed = [
    "fullName",
    "cpf",
    "phone",
    "email",
    "vehicleModel",
    "vehicleYear",
    "capacity",
    "compartments",
    "plate",
    "cnh",
    "cnhCategory",
    "cnhExpiresAt",
    "city",
    "state",
    "notes",
    "locationSharingAuthorized",
  ];
  const data = Object.fromEntries(
    Object.entries(body).filter(([key]) => allowed.includes(key)),
  );
  if (data.cnhExpiresAt) data.cnhExpiresAt = new Date(data.cnhExpiresAt);
  if ("cpf" in data) data.cpf = normalizeDocument(data.cpf);
  if ("cnh" in data) data.cnh = normalizeDocument(data.cnh);
  try {
    await prisma.driver.update({ where: { id: request.user.driver.id }, data });
  } catch (error) {
    if (error?.code === "P2002")
      return response.status(409).json({ error: uniqueConflictMessage(error) });
    throw error;
  }
  const driver = await prisma.driver.findUnique({
    where: { id: request.user.driver.id },
    include: {
      vehicleAssignments: {
        where: { endedAt: null },
        include: { vehicle: { include: { company: true, products: true } } },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
      carrierLinks: {
        where: { endedAt: null },
        include: { company: true },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  });
  broadcast("driver-updated");
  response.json({ driver: publicDriver(driver) });
});

app.patch("/api/drivers/me/location", auth, async (request, response) => {
  if (!request.user.driver)
    return response
      .status(404)
      .json({ error: "Motorista ainda não cadastrado" });
  const { latitude, longitude } = request.body || {};
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return response.status(400).json({ error: "Coordenadas inválidas" });
  const driver = await prisma.driver.update({
    where: { id: request.user.driver.id },
    data: { latitude, longitude, lastSeen: new Date() },
  });
  broadcast("driver-location");
  response.json({ driver: publicDriver(driver) });
});

app.patch("/api/drivers/me/status", auth, async (request, response) => {
  if (!request.user.driver)
    return response
      .status(404)
      .json({ error: "Motorista ainda não cadastrado" });
  const { isOnline, status, notes, availabilityCity, availabilityAt } =
    request.body || {};
  const validStatuses = [
    "offline",
    "available",
    "awaiting_loading",
    "awaiting_documents",
    "in_transit",
    "at_collection",
    "awaiting_unloading",
    "driver_completed",
    "in_negotiation",
    "on_trip",
  ];
  if (typeof isOnline !== "boolean" || !validStatuses.includes(status))
    return response.status(400).json({ error: "Status inválido" });
  const normalizedAvailabilityCity =
    typeof availabilityCity === "string" ? availabilityCity.trim() : "";
  const parsedAvailabilityAt =
    typeof availabilityAt === "string" ? new Date(availabilityAt) : null;
  if (
    isOnline &&
    (!normalizedAvailabilityCity ||
      !parsedAvailabilityAt ||
      !Number.isFinite(parsedAvailabilityAt.getTime()))
  ) {
    return response.status(400).json({
      error: "Informe a cidade, data e hora previstas para ficar disponível",
    });
  }
  const driver = await prisma.driver.update({
    where: { id: request.user.driver.id },
    data: {
      isOnline,
      status,
      notes,
      lastSeen: new Date(),
      availabilitySince: isOnline
        ? new Date()
        : request.user.driver.availabilitySince,
      availabilityCity: isOnline ? normalizedAvailabilityCity : null,
      availabilityAt: isOnline ? parsedAvailabilityAt : null,
    },
  });
  broadcast("driver-status");
  response.json({ driver: publicDriver(driver) });
});

const driverChatTypingIndicators = new Map();

const canAccessDriverChat = (request, driverId) =>
  request.user.profile?.isSuperAdmin === true ||
  ["admin", "operator"].includes(request.user.profile?.role) ||
  request.user.driver?.id === driverId;

app.get(
  "/api/drivers/:driverId/chat/messages",
  auth,
  async (request, response) => {
    const { driverId } = request.params;
    if (!canAccessDriverChat(request, driverId))
      return response
        .status(403)
        .json({ error: "Acesso ao chat não autorizado" });
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver)
      return response.status(404).json({ error: "Motorista não encontrado" });
    const messages = await prisma.driverChatMessage.findMany({
      where: { driverId },
      include: {
        sender: true,
        freightOffer: {
          include: {
            driver: true,
            route: { include: { collectionPoint: true, finalCustomer: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    response.json({
      messages: messages.map((message) => ({
        id: message.id,
        user_id: message.userId,
        body: message.body,
        kind: message.kind,
        created_at: message.createdAt.toISOString(),
        freight_offer: message.freightOffer
          ? publicFreightChatOffer(message.freightOffer)
          : null,
        user: {
          full_name: message.sender.fullName,
          email: message.sender.email,
        },
      })),
    });
  },
);

app.post(
  "/api/drivers/:driverId/chat/messages",
  auth,
  async (request, response) => {
    const { driverId } = request.params;
    if (!canAccessDriverChat(request, driverId))
      return response
        .status(403)
        .json({ error: "Acesso ao chat não autorizado" });
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver)
      return response.status(404).json({ error: "Motorista não encontrado" });
    const body =
      typeof request.body?.body === "string"
        ? request.body.body.trim().slice(0, 1000)
        : "";
    if (!body)
      return response
        .status(400)
        .json({ error: "A mensagem não pode ficar vazia" });
    const message = await prisma.driverChatMessage.create({
      data: { driverId, userId: request.user.id, body },
      include: { sender: true },
    });
    broadcast("driver-chat-message-created");
    response.status(201).json({
      message: {
        id: message.id,
        user_id: message.userId,
        body: message.body,
        created_at: message.createdAt.toISOString(),
        freight_offer: null,
        user: {
          full_name: message.sender.fullName,
          email: message.sender.email,
        },
      },
    });
  },
);

app.post(
  "/api/drivers/:driverId/chat/offers",
  auth,
  requireOperations,
  async (request, response) => {
    const { driverId } = request.params;
    const body = request.body || {};
    return response.status(410).json({
      error: "O envio de valores para motoristas foi desativado",
    });
    const collectionPointId =
      typeof body.collectionPointId === "string" ? body.collectionPointId : "";
    const finalCustomerId =
      typeof body.finalCustomerId === "string" ? body.finalCustomerId : "";
    const amountCents = body.amountCents;
    if (
      !collectionPointId ||
      !finalCustomerId ||
      collectionPointId === finalCustomerId
    )
      return response.status(400).json({ error: "Origem e destino inválidos" });
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
      return response.status(400).json({ error: "Informe um valor válido" });

    const [driver, collectionPoint, finalCustomer] = await Promise.all([
      prisma.driver.findUnique({ where: { id: driverId } }),
      prisma.operationalLocation.findUnique({
        where: { id: collectionPointId },
      }),
      prisma.operationalLocation.findUnique({ where: { id: finalCustomerId } }),
    ]);
    if (!driver)
      return response.status(404).json({ error: "Motorista não encontrado" });
    if (
      !collectionPoint ||
      collectionPoint.kind !== "collection_point" ||
      !collectionPoint.active ||
      !finalCustomer ||
      finalCustomer.kind !== "final_customer" ||
      !finalCustomer.active
    )
      return response.status(400).json({ error: "Rota inválida ou inativa" });

    let route = null;
    if (typeof body.routeId === "string" && body.routeId) {
      route = await prisma.freightRoute.findUnique({
        where: { id: body.routeId },
      });
      if (
        !route ||
        route.collectionPointId !== collectionPointId ||
        route.finalCustomerId !== finalCustomerId ||
        !freightRouteOpenStatuses.includes(route.status)
      )
        return response
          .status(409)
          .json({ error: "Esta rota não está disponível para novas ofertas" });
    } else {
      if (
        ![collectionPoint, finalCustomer].every(
          (point) =>
            Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
        )
      )
        return response.status(400).json({
          error: "A rota precisa ter coordenadas GPS para calcular a distância",
        });
      const coordinates = `${collectionPoint.longitude},${collectionPoint.latitude};${finalCustomer.longitude},${finalCustomer.latitude}`;
      const { body: routeBody, error: osrmError } = await fetchOsrmRoute(
        coordinates,
        "overview=false&steps=false",
      );
      if (osrmError) return response.status(502).json({ error: osrmError });
      const distanceMeters = routeBody.routes?.[0]?.distance;
      if (routeBody.code !== "Ok" || !Number.isFinite(distanceMeters))
        return response.status(422).json({
          error: "Não foi possível calcular a distância da rota",
        });
      route = await prisma.freightRoute.create({
        data: {
          createdByUserId: request.user.id,
          collectionPointId,
          finalCustomerId,
          distanceKm: distanceMeters / 1000,
        },
      });
    }

    const messageText = `Oferta de frete: ${new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amountCents / 100)}.`;
    const result = await prisma.$transaction(async (transaction) => {
      const offer = await transaction.freightChatOffer.create({
        data: {
          routeId: route.id,
          driverId,
          createdByUserId: request.user.id,
          amountCents,
        },
      });
      const message = await transaction.driverChatMessage.create({
        data: {
          driverId,
          userId: request.user.id,
          body: messageText,
          freightOfferId: offer.id,
        },
        include: { sender: true },
      });
      return { offer, message };
    });
    broadcast("freight-chat-offer-created");
    response.status(201).json({
      offer: publicFreightChatOffer({
        ...result.offer,
        driver,
        route: { ...route, collectionPoint, finalCustomer },
      }),
      message: {
        id: result.message.id,
        user_id: result.message.userId,
        body: result.message.body,
        created_at: result.message.createdAt.toISOString(),
        freight_offer: publicFreightChatOffer({
          ...result.offer,
          driver,
          route: { ...route, collectionPoint, finalCustomer },
        }),
        user: {
          full_name: result.message.sender.fullName,
          email: result.message.sender.email,
        },
      },
    });
  },
);

app.post(
  "/api/drivers/:driverId/chat/offers/:offerId/decision",
  auth,
  async (request, response) => {
    const driverId = request.params.driverId;
    if (request.user.driver?.id !== driverId)
      return response
        .status(403)
        .json({ error: "Somente o motorista pode responder à oferta" });
    const decision = request.body?.decision;
    if (!["accept", "reject"].includes(decision))
      return response
        .status(400)
        .json({ error: "Resposta de oferta inválida" });
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        vehicleAssignments: {
          where: { endedAt: null },
          include: { vehicle: true },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!driver)
      return response.status(404).json({ error: "Motorista não encontrado" });
    if (decision === "accept" && driver.homologationStatus !== "active")
      return response.status(409).json({
        error:
          "A homologação do motorista precisa estar ativa para aceitar ofertas",
      });
    const capacity =
      driver.capacity?.trim() ||
      driver.vehicleAssignments?.[0]?.vehicle?.capacity?.trim() ||
      "";
    if (decision === "accept" && !capacity)
      return response.status(409).json({
        error: "Cadastre a capacidade do veículo antes de aceitar a oferta",
      });

    try {
      const result = await prisma.$transaction(async (transaction) => {
        const offer = await transaction.freightChatOffer.findFirst({
          where: {
            id: request.params.offerId,
            driverId,
            status: "offered",
          },
          include: { route: true },
        });
        if (!offer) throw new Error("OFFER_NOT_AVAILABLE");
        let assignment = null;
        if (decision === "accept") {
          if (!freightRouteOpenStatuses.includes(offer.route.status))
            throw new Error("ROUTE_NOT_AVAILABLE");
          const existingActive =
            await transaction.freightRouteAssignment.findFirst({
              where: { driverId, status: "active" },
            });
          if (existingActive) throw new Error("EXISTING_ACTIVE_ROUTE");
          assignment = await transaction.freightRouteAssignment.create({
            data: { routeId: offer.routeId, driverId, capacity },
          });
          await transaction.freightRoute.update({
            where: { id: offer.routeId },
            data: { status: "assigned" },
          });
          await transaction.freightChatOffer.updateMany({
            where: {
              routeId: offer.routeId,
              driverId,
              status: "offered",
              id: { not: offer.id },
            },
            data: { status: "superseded", respondedAt: new Date() },
          });
        }
        const updatedOffer = await transaction.freightChatOffer.update({
          where: { id: offer.id },
          data: {
            status: decision === "accept" ? "accepted" : "rejected",
            respondedAt: new Date(),
            acceptedAssignmentId: assignment?.id ?? null,
          },
          include: {
            driver: true,
            route: { include: { collectionPoint: true, finalCustomer: true } },
          },
        });
        const amount = new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(offer.amountCents / 100);
        const message = await transaction.driverChatMessage.create({
          data: {
            driverId,
            userId: request.user.id,
            body:
              decision === "accept"
                ? `Oferta de frete aceita. Valor acordado: ${amount}.`
                : `Oferta de frete recusada: ${amount}.`,
          },
          include: { sender: true },
        });
        return { offer: updatedOffer, message };
      });
      broadcast("freight-chat-offer-responded");
      response.json({
        offer: publicFreightChatOffer(result.offer),
        message: {
          id: result.message.id,
          user_id: result.message.userId,
          body: result.message.body,
          created_at: result.message.createdAt.toISOString(),
          freight_offer: null,
          user: {
            full_name: result.message.sender.fullName,
            email: result.message.sender.email,
          },
        },
      });
    } catch (error) {
      const responses = {
        OFFER_NOT_AVAILABLE: [409, "Esta oferta já foi respondida"],
        ROUTE_NOT_AVAILABLE: [409, "Esta rota já foi encerrada"],
        EXISTING_ACTIVE_ROUTE: [409, "Você já possui um frete em andamento"],
      };
      const [status, message] = responses[error.message] ?? [
        500,
        "Não foi possível responder à oferta",
      ];
      response.status(status).json({ error: message });
    }
  },
);

const driverChatTypingHandler = async (request, response) => {
  const { driverId } = request.params;
  if (!canAccessDriverChat(request, driverId))
    return response
      .status(403)
      .json({ error: "Acesso ao chat não autorizado" });
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver)
    return response.status(404).json({ error: "Motorista não encontrado" });
  const key = `${driverId}:${request.user.id}`;
  const now = Date.now();
  for (const [indicatorKey, indicator] of driverChatTypingIndicators) {
    if (indicator.expiresAt <= now)
      driverChatTypingIndicators.delete(indicatorKey);
  }
  if (request.method === "POST") {
    if (request.body?.isTyping === true) {
      driverChatTypingIndicators.set(key, {
        driverId,
        userId: request.user.id,
        fullName:
          request.user.driver?.fullName ??
          request.user.profile?.fullName ??
          request.user.fullName ??
          "Usuário",
        expiresAt: now + 4000,
      });
    } else {
      driverChatTypingIndicators.delete(key);
    }
    return response.status(204).end();
  }
  const users = [...driverChatTypingIndicators.values()]
    .filter(
      (indicator) =>
        indicator.driverId === driverId &&
        indicator.userId !== request.user.id &&
        indicator.expiresAt > now,
    )
    .map(({ userId, fullName }) => ({ user_id: userId, full_name: fullName }));
  response.json({ users });
};

app.get("/api/drivers/:driverId/chat/typing", auth, driverChatTypingHandler);
app.post("/api/drivers/:driverId/chat/typing", auth, driverChatTypingHandler);

app.get(
  "/api/admin/driver-chat-messages",
  auth,
  requireSuperAdmin,
  async (request, response) => {
    const query =
      typeof request.query.q === "string"
        ? request.query.q.trim().slice(0, 100)
        : "";
    const parsedOffset = Number.parseInt(
      String(request.query.offset ?? "0"),
      10,
    );
    const offset = Number.isFinite(parsedOffset)
      ? Math.max(0, Math.min(parsedOffset, 100000))
      : 0;
    const pageSize = 50;
    const where = query
      ? {
          OR: [
            { body: { contains: query } },
            { sender: { is: { fullName: { contains: query } } } },
            { sender: { is: { email: { contains: query } } } },
            { driver: { is: { id: { contains: query } } } },
            { driver: { is: { fullName: { contains: query } } } },
          ],
        }
      : {};
    const messages = await prisma.driverChatMessage.findMany({
      where,
      skip: offset,
      take: pageSize + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        sender: { select: { id: true, fullName: true, email: true } },
        driver: { select: { id: true, fullName: true } },
      },
    });
    response.json({
      messages: messages.slice(0, pageSize).map((message) => ({
        id: message.id,
        body: message.body,
        created_at: message.createdAt.toISOString(),
        user: {
          id: message.sender.id,
          full_name: message.sender.fullName,
          email: message.sender.email,
        },
        driver: {
          id: message.driver.id,
          full_name: message.driver.fullName,
        },
      })),
      has_more: messages.length > pageSize,
    });
  },
);

const isOperationsUser = (request) =>
  ["admin", "operator"].includes(request.user.profile?.role);

const fetchOsrmRoute = async (coordinates, query) => {
  let routeResponse;
  try {
    routeResponse = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?${query}`,
    );
  } catch {
    return {
      error: "Não foi possível conectar ao serviço de cálculo de rotas",
    };
  }
  if (!routeResponse.ok) return { error: "Serviço de rotas indisponível" };
  try {
    return { body: await routeResponse.json() };
  } catch {
    return { error: "Resposta inválida do serviço de cálculo de rotas" };
  }
};

app.get("/api/drivers", auth, async (request, response) => {
  if (!["operator", "admin"].includes(request.user.profile?.role))
    return response.status(403).json({ error: "Acesso não permitido" });
  const activeSince = new Date(Date.now() - 2 * 60 * 1000);
  const drivers = await prisma.driver.findMany({
    where: { isOnline: true, lastSeen: { gte: activeSince } },
    include: {
      vehicleAssignments: {
        where: { endedAt: null },
        include: { vehicle: { include: { company: true } } },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
      carrierLinks: {
        where: { endedAt: null },
        include: { company: true },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
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
    address:
      typeof body.address === "string" ? body.address.trim() || null : null,
    city: typeof body.city === "string" ? body.city.trim() || null : null,
    state: typeof body.state === "string" ? body.state.trim() || null : null,
    latitude: body.latitude == null ? null : Number(body.latitude),
    longitude: body.longitude == null ? null : Number(body.longitude),
    active: body.active !== false,
  };
  if (!validLocationKinds.includes(kind))
    throw new Error("Tipo de ponto operacional inválido");
  if (!name) throw new Error("Nome do ponto operacional é obrigatório");
  if (
    data.latitude != null &&
    (!Number.isFinite(data.latitude) ||
      data.latitude < -90 ||
      data.latitude > 90)
  )
    throw new Error("Latitude inválida");
  if (
    data.longitude != null &&
    (!Number.isFinite(data.longitude) ||
      data.longitude < -180 ||
      data.longitude > 180)
  )
    throw new Error("Longitude inválida");
  return data;
};

const ensureRoutableLocation = (location) => {
  if (
    !location.address ||
    !location.city ||
    !location.state ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  )
    throw new Error("Informe endereço, cidade, UF e GPS válidos para o local");
};

const resolveExistingCompanyIds = async (transaction, companyIds) => {
  if (!companyIds.length) return [];
  const existingCompanies = await transaction.transportCompany.findMany({
    where: { id: { in: companyIds } },
    select: { id: true },
  });
  const existingIds = new Set(existingCompanies.map((company) => company.id));
  const invalidIds = companyIds.filter((id) => !existingIds.has(id));
  if (invalidIds.length) {
    throw new Error(
      `Transportadoras inválidas ou não persistidas: ${invalidIds.join(", ")}`,
    );
  }
  return companyIds;
};

app.get(
  "/api/operations/locations",
  auth,
  requireOperations,
  async (request, response) => {
    const locations = await prisma.operationalLocation.findMany({
      where: { active: true },
      include: { companyAccesses: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
    const companies = ["admin", "operator"].includes(request.user.profile?.role)
      ? await prisma.transportCompany.findMany({
          orderBy: { legalName: "asc" },
        })
      : [];
    response.json({ locations: locations.map(publicOperationalLocation) });
  },
);

app.post(
  "/api/operations/locations",
  auth,
  requireOperations,
  async (request, response) => {
    try {
      const companyIds = Array.isArray(request.body?.companyIds)
        ? [
            ...new Set(
              request.body.companyIds
                .filter((id) => typeof id === "string" && id.trim())
                .map((id) => id.trim()),
            ),
          ]
        : [];
      const location = await prisma.$transaction(async (transaction) => {
        const data = locationPayload(request.body);
        ensureRoutableLocation(data);
        const existingCompanyIds = await resolveExistingCompanyIds(
          transaction,
          companyIds,
        );
        const createdLocation = await transaction.operationalLocation.create({
          data,
        });
        if (existingCompanyIds.length) {
          await transaction.operationalLocationCompanyAccess.createMany({
            data: existingCompanyIds.map((companyId) => ({
              locationId: createdLocation.id,
              companyId,
            })),
          });
        }
        return transaction.operationalLocation.findUnique({
          where: { id: createdLocation.id },
          include: { companyAccesses: true },
        });
      });
      broadcast("operational-location-created");
      response
        .status(201)
        .json({ location: publicOperationalLocation(location) });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "Ponto operacional inválido",
      });
    }
  },
);

app.patch(
  "/api/operations/locations/:locationId",
  auth,
  requireOperations,
  async (request, response) => {
    try {
      const companyIds = Array.isArray(request.body?.companyIds)
        ? [
            ...new Set(
              request.body.companyIds
                .filter((id) => typeof id === "string" && id.trim())
                .map((id) => id.trim()),
            ),
          ]
        : [];
      const location = await prisma.$transaction(async (transaction) => {
        const current = await transaction.operationalLocation.findUnique({
          where: { id: request.params.locationId },
        });
        if (!current) throw new Error("Ponto operacional não encontrado");
        const data = locationPayload(request.body);
        const routeFields = [
          "address",
          "city",
          "state",
          "latitude",
          "longitude",
        ];
        const addressChanged = routeFields.some(
          (field) =>
            request.body?.[field] !== undefined &&
            request.body[field] !== current[field],
        );
        if (addressChanged) ensureRoutableLocation(data);
        const updatedLocation = await transaction.operationalLocation.update({
          where: { id: request.params.locationId },
          data,
        });
        const existingCompanyIds = await resolveExistingCompanyIds(
          transaction,
          companyIds,
        );
        await transaction.operationalLocationCompanyAccess.deleteMany({
          where: { locationId: updatedLocation.id },
        });
        if (existingCompanyIds.length) {
          await transaction.operationalLocationCompanyAccess.createMany({
            data: existingCompanyIds.map((companyId) => ({
              locationId: updatedLocation.id,
              companyId,
            })),
          });
        }
        return transaction.operationalLocation.findUnique({
          where: { id: updatedLocation.id },
          include: { companyAccesses: true },
        });
      });
      broadcast("operational-location-updated");
      response.json({ location: publicOperationalLocation(location) });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "Ponto operacional inválido",
      });
    }
  },
);

app.delete(
  "/api/operations/locations/:locationId",
  auth,
  requireOperations,
  async (request, response) => {
    await prisma.operationalLocation.update({
      where: { id: request.params.locationId },
      data: { active: false },
    });
    broadcast("operational-location-deleted");
    response.status(204).end();
  },
);

app.post(
  "/api/operations/routes",
  auth,
  requireOperations,
  async (request, response) => {
    const { driverId, collectionPointId, finalCustomerId } = request.body || {};
    const [driver, collectionPoint, finalCustomer] = await Promise.all([
      prisma.driver.findUnique({ where: { id: driverId } }),
      prisma.operationalLocation.findUnique({
        where: { id: collectionPointId },
      }),
      prisma.operationalLocation.findUnique({ where: { id: finalCustomerId } }),
    ]);
    const points = [driver, collectionPoint, finalCustomer];
    if (
      !driver ||
      !collectionPoint ||
      !finalCustomer ||
      collectionPoint.kind !== "collection_point" ||
      finalCustomer.kind !== "final_customer"
    )
      return response.status(400).json({
        error: "Motorista, posto de coleta e cliente final são obrigatórios",
      });
    if (
      points.some(
        (point) =>
          !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude),
      )
    )
      return response
        .status(400)
        .json({ error: "Todos os pontos precisam ter coordenadas GPS" });
    if (
      collectionPoint.latitude === finalCustomer.latitude &&
      collectionPoint.longitude === finalCustomer.longitude
    )
      return response.status(422).json({
        error:
          "Posto de coleta e cliente final foram localizados no mesmo ponto. Edite os endereços e confirme número, cidade e UF.",
      });
    const coordinates = points
      .map((point) => `${point.longitude},${point.latitude}`)
      .join(";");
    const { body: routeBody, error: osrmError } = await fetchOsrmRoute(
      coordinates,
      "overview=full&geometries=geojson&steps=false",
    );
    if (osrmError) return response.status(502).json({ error: osrmError });
    const route = routeBody.routes?.[0];
    if (routeBody.code !== "Ok" || !route)
      return response
        .status(422)
        .json({ error: "Não foi possível calcular a rota entre os pontos" });
    response.json({
      order: ["driver", "collection_point", "final_customer"],
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
    });
  },
);

app.get(
  "/api/operations/directory",
  auth,
  requireOperations,
  async (request, response) => {
    const activeSince = new Date(Date.now() - 2 * 60 * 1000);
    const driverRelations = {
      vehicleAssignments: {
        where: { endedAt: null },
        include: { vehicle: { include: { company: true, products: true } } },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
      carrierLinks: {
        where: { endedAt: null },
        include: { company: true },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    };
    const drivers = await prisma.driver.findMany({
      where: { isOnline: true, lastSeen: { gte: activeSince } },
      include: driverRelations,
      orderBy: { availabilitySince: "asc" },
    });
    const allDrivers = ["admin", "operator"].includes(
      request.user.profile?.role,
    )
      ? await prisma.driver.findMany({
          include: driverRelations,
          orderBy: { fullName: "asc" },
        })
      : [];
    const operators =
      request.user.profile?.role === "admin"
        ? await prisma.user.findMany({
            where: { profile: { role: "operator", approved: true } },
            include: { profile: true },
            orderBy: { fullName: "asc" },
          })
        : [];
    const locations = await prisma.operationalLocation.findMany({
      where: { active: true },
      include: { companyAccesses: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
    const companies = ["admin", "operator"].includes(request.user.profile?.role)
      ? await prisma.transportCompany.findMany({
          include: { vehicles: true },
          orderBy: { legalName: "asc" },
        })
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
      })),
      locations: locations.map(publicOperationalLocation),
      companies: companies.map((company) => ({
        id: company.id,
        name: company.legalName,
        cnpj: company.cnpj,
        status: company.status,
      })),
      vehicles: companies.flatMap((company) =>
        company.vehicles.map((vehicle) => ({
          id: vehicle.id,
          type: vehicle.type,
          plate: vehicle.plate,
          capacity: vehicle.capacity || "",
          compartments: vehicle.compartments || "",
          products: vehicle.productType || "",
          companyId: company.id,
          driverId: "",
          status: vehicle.homologationStatus,
        })),
      ),
    });
  },
);

app.get(
  "/api/carrier/registrations",
  auth,
  requireCarrier,
  async (request, response) => {
    const companyId = request.user.profile.companyId;
    const [drivers, vehicles] = await Promise.all([
      prisma.driver.findMany({
        where: { carrierLinks: { some: { companyId, endedAt: null } } },
        orderBy: { fullName: "asc" },
      }),
      prisma.vehicle.findMany({
        where: { companyId },
        include: {
          products: true,
          driverAssignments: {
            where: { endedAt: null },
            include: { driver: true },
            orderBy: { startedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { plate: "asc" },
      }),
    ]);
    response.json({
      drivers: drivers.map(publicDriver),
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.id,
        type: vehicle.type,
        plate: vehicle.plate,
        capacity: vehicle.capacity,
        products: vehicle.products
          .filter((product) => product.enabled)
          .map((product) => product.product),
        status: vehicle.homologationStatus,
        current_driver: vehicle.driverAssignments[0]?.driver
          ? {
              id: vehicle.driverAssignments[0].driver.id,
              full_name: vehicle.driverAssignments[0].driver.fullName,
            }
          : null,
      })),
    });
  },
);

app.get("/api/carrier/map", auth, requireCarrier, async (request, response) => {
  const companyId = request.user.profile.companyId;
  const activeSince = new Date(Date.now() - 2 * 60 * 1000);
  const [company, drivers, locations] = await Promise.all([
    prisma.transportCompany.findUnique({ where: { id: companyId } }),
    prisma.driver.findMany({
      where: {
        isOnline: true,
        lastSeen: { gte: activeSince },
        carrierLinks: { some: { companyId, endedAt: null } },
      },
      include: {
        vehicleAssignments: {
          where: { endedAt: null },
          include: { vehicle: { include: { company: true, products: true } } },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
        carrierLinks: {
          where: { endedAt: null },
          include: { company: true },
          take: 1,
        },
      },
      orderBy: { availabilitySince: "asc" },
    }),
    prisma.operationalLocation.findMany({
      where: { active: true, companyAccesses: { some: { companyId } } },
      include: { companyAccesses: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
  ]);
  response.json({
    drivers: drivers.map((driver) => ({
      ...publicDriver(driver),
      carrier: publicCompany(driver.carrierLinks?.[0]?.company ?? company),
    })),
    locations: locations.map(publicOperationalLocation),
  });
});

app.post(
  "/api/carrier/drivers",
  auth,
  requireCarrier,
  async (request, response) => {
    const fullName =
      typeof request.body?.fullName === "string"
        ? request.body.fullName.trim()
        : "";
    const email =
      typeof request.body?.email === "string"
        ? request.body.email.trim().toLowerCase()
        : "";
    const phone =
      typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
    const password =
      typeof request.body?.password === "string" ? request.body.password : "";
    const cpf = normalizeDocument(request.body?.cpf) ?? "";
    const cnh = normalizeDocument(request.body?.cnh) ?? "";
    const cnhCategory =
      typeof request.body?.cnhCategory === "string"
        ? request.body.cnhCategory.trim()
        : "";
    const cnhExpiresAt =
      typeof request.body?.cnhExpiresAt === "string"
        ? request.body.cnhExpiresAt.trim()
        : "";
    const city =
      typeof request.body?.city === "string" ? request.body.city.trim() : "";
    const state =
      typeof request.body?.state === "string" ? request.body.state.trim() : "";
    const vehicleModel =
      typeof request.body?.vehicleModel === "string"
        ? request.body.vehicleModel.trim()
        : "";
    const vehicleYear =
      typeof request.body?.vehicleYear === "string"
        ? request.body.vehicleYear.trim()
        : "";
    const plate =
      typeof request.body?.plate === "string"
        ? request.body.plate.trim().toUpperCase()
        : "";
    const capacity =
      typeof request.body?.capacity === "string"
        ? request.body.capacity.trim()
        : "";
    const compartments =
      typeof request.body?.compartments === "string"
        ? request.body.compartments.trim()
        : "";
    const locationSharingAuthorized =
      request.body?.locationSharingAuthorized === true;
    const birthDate = normalizeBirthDate(request.body?.birthDate);
    if (
      !fullName ||
      !email ||
      !phone ||
      !birthDate ||
      password.length < 6 ||
      [
        cpf,
        cnh,
        cnhCategory,
        cnhExpiresAt,
        city,
        state,
        vehicleModel,
        vehicleYear,
        plate,
        capacity,
        compartments,
      ].some((value) => !value)
    )
      return response
        .status(400)
        .json({ error: "Preencha todos os campos obrigatórios do motorista" });
    try {
      const passwordHash = await hashPassword(password);
      const user = await prisma.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: {
            fullName,
            email,
            phone,
            birthDate,
            passwordHash,
            profile: {
              create: {
                fullName,
                role: "driver",
                requestedRole: "driver",
                companyId: request.user.profile.companyId,
                approved: false,
                registrationNotes: "Cadastro criado pela transportadora",
              },
            },
            driver: {
              create: {
                fullName,
                email,
                phone,
                cpf,
                cnh,
                cnhCategory,
                cnhExpiresAt: new Date(cnhExpiresAt),
                city,
                state,
                vehicleModel,
                vehicleYear: Number(vehicleYear),
                plate,
                capacity,
                compartments,
                locationSharingAuthorized,
                employmentType: "carrier",
                homologationStatus: "in_analysis",
              },
            },
          },
        });
        const driver = await transaction.driver.findUnique({
          where: { userId: createdUser.id },
        });
        await transaction.driverCarrierLink.create({
          data: {
            driverId: driver.id,
            companyId: request.user.profile.companyId,
          },
        });
        return createdUser;
      });
      broadcast("registration-created");
      response.status(202).json({
        pending: true,
        user: { id: user.id, full_name: fullName, email, phone },
      });
    } catch (error) {
      if (error?.code === "P2002")
        return response
          .status(409)
          .json({ error: uniqueConflictMessage(error) });
      response
        .status(400)
        .json({ error: "Não foi possível solicitar o cadastro do motorista" });
    }
  },
);

app.post(
  "/api/carrier/vehicles",
  auth,
  requireCarrier,
  async (request, response) => {
    const type =
      typeof request.body?.type === "string" ? request.body.type.trim() : "";
    const plate =
      typeof request.body?.plate === "string"
        ? request.body.plate.trim().toUpperCase()
        : "";
    const products = Array.isArray(request.body?.products)
      ? request.body.products
          .filter((product) => typeof product === "string" && product.trim())
          .map((product) => product.trim())
      : [];
    if (!type || !plate)
      return response
        .status(400)
        .json({ error: "Tipo e placa são obrigatórios" });
    try {
      const vehicle = await prisma.vehicle.create({
        data: {
          companyId: request.user.profile.companyId,
          type,
          plate,
          capacity: request.body?.capacity?.trim() || null,
          compartments: request.body?.compartments?.trim() || null,
          homologationStatus: "in_analysis",
          products: { create: products.map((product) => ({ product })) },
        },
        include: { products: true },
      });
      broadcast("vehicle-registration-created");
      response.status(202).json({
        vehicle: {
          id: vehicle.id,
          type: vehicle.type,
          plate: vehicle.plate,
          status: vehicle.homologationStatus,
          products: vehicle.products.map((product) => product.product),
        },
      });
    } catch (error) {
      if (error?.code === "P2002")
        return response
          .status(409)
          .json({ error: "Esta placa já está cadastrada" });
      response
        .status(400)
        .json({ error: "Não foi possível solicitar o cadastro do veículo" });
    }
  },
);

app.post(
  "/api/carrier/vehicles/:vehicleId/driver",
  auth,
  requireCarrier,
  async (request, response) => {
    const companyId = request.user.profile.companyId;
    const driverId =
      typeof request.body?.driverId === "string" ? request.body.driverId : "";
    const [vehicle, driver] = await Promise.all([
      prisma.vehicle.findFirst({
        where: { id: request.params.vehicleId, companyId },
      }),
      prisma.driver.findFirst({
        where: {
          id: driverId,
          carrierLinks: { some: { companyId, endedAt: null } },
        },
      }),
    ]);
    if (!vehicle || !driver)
      return response
        .status(404)
        .json({ error: "Veículo ou motorista não pertence à transportadora" });
    if (
      vehicle.homologationStatus !== "active" ||
      driver.homologationStatus !== "active"
    )
      return response.status(409).json({
        error: "Veículo e motorista precisam estar ativos para criar o vínculo",
      });
    const assignment = await prisma.$transaction(async (transaction) => {
      await transaction.vehicleDriverAssignment.updateMany({
        where: { vehicleId: vehicle.id, endedAt: null },
        data: { endedAt: new Date(), status: "ended" },
      });
      return transaction.vehicleDriverAssignment.create({
        data: { vehicleId: vehicle.id, driverId: driver.id },
      });
    });
    broadcast("vehicle-driver-linked");
    response.status(201).json({ assignment });
  },
);

app.get(
  "/api/admin/pending-vehicles",
  auth,
  requireOperations,
  async (_request, response) => {
    const vehicles = await prisma.vehicle.findMany({
      where: { homologationStatus: "in_analysis" },
      include: { company: true, products: true },
      orderBy: { createdAt: "asc" },
    });
    response.json({
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.id,
        type: vehicle.type,
        plate: vehicle.plate,
        capacity: vehicle.capacity,
        company: publicCompany(vehicle.company),
        products: vehicle.products.map((product) => product.product),
        status: vehicle.homologationStatus,
      })),
    });
  },
);

app.patch(
  "/api/admin/vehicles/:vehicleId/approval",
  auth,
  requireOperations,
  async (request, response) => {
    const status = ["active", "rejected", "blocked"].includes(
      request.body?.status,
    )
      ? request.body.status
      : null;
    if (!status)
      return response
        .status(400)
        .json({ error: "Informe uma situação válida" });
    const vehicle = await prisma.vehicle.update({
      where: { id: request.params.vehicleId },
      data: { homologationStatus: status },
    });
    broadcast("vehicle-approval-updated");
    response.json({
      vehicle: { id: vehicle.id, status: vehicle.homologationStatus },
    });
  },
);

app.post(
  "/api/operations/vehicles/:vehicleId/driver",
  auth,
  requireOperations,
  async (request, response) => {
    const { driverId } = request.body || {};
    if (typeof driverId !== "string" || !driverId)
      return response.status(400).json({ error: "Motorista é obrigatório" });
    try {
      const assignment = await prisma.$transaction(async (transaction) => {
        const vehicle = await transaction.vehicle.findUnique({
          where: { id: request.params.vehicleId },
        });
        const driver = await transaction.driver.findUnique({
          where: { id: driverId },
        });
        if (!vehicle || !driver)
          throw new Error("Veículo ou motorista não encontrado");
        await transaction.vehicleDriverAssignment.updateMany({
          where: { vehicleId: vehicle.id, endedAt: null },
          data: { endedAt: new Date(), status: "ended" },
        });
        return transaction.vehicleDriverAssignment.create({
          data: { vehicleId: vehicle.id, driverId: driver.id },
        });
      });
      broadcast("vehicle-driver-linked");
      response.status(201).json({ assignment });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível vincular o motorista",
      });
    }
  },
);

app.delete(
  "/api/operations/vehicles/:vehicleId/driver",
  auth,
  requireOperations,
  async (request, response) => {
    const result = await prisma.vehicleDriverAssignment.updateMany({
      where: { vehicleId: request.params.vehicleId, endedAt: null },
      data: { endedAt: new Date(), status: "ended" },
    });
    if (result.count === 0)
      return response
        .status(404)
        .json({ error: "Vínculo ativo não encontrado" });
    broadcast("vehicle-driver-unlinked");
    response.status(204).end();
  },
);

app.post(
  "/api/operations/drivers/:driverId/carrier",
  auth,
  requireOperations,
  async (request, response) => {
    const { companyId } = request.body || {};
    if (typeof companyId !== "string" || !companyId)
      return response
        .status(400)
        .json({ error: "Transportadora é obrigatória" });
    try {
      const link = await prisma.$transaction(async (transaction) => {
        const [driver, company] = await Promise.all([
          transaction.driver.findUnique({
            where: { id: request.params.driverId },
          }),
          transaction.transportCompany.findUnique({ where: { id: companyId } }),
        ]);
        if (!driver || !company)
          throw new Error("Motorista ou transportadora não encontrado");
        await transaction.driverCarrierLink.updateMany({
          where: { driverId: driver.id, endedAt: null },
          data: { endedAt: new Date(), status: "ended" },
        });
        await transaction.driver.update({
          where: { id: driver.id },
          data: { employmentType: "carrier" },
        });
        return transaction.driverCarrierLink.create({
          data: { driverId: driver.id, companyId: company.id },
        });
      });
      broadcast("driver-carrier-linked");
      response.status(201).json({ link });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível vincular a transportadora",
      });
    }
  },
);

app.patch(
  "/api/admin/drivers/:driverId",
  auth,
  requireOperations,
  async (request, response) => {
    const allowed = [
      "fullName",
      "email",
      "vehicleModel",
      "vehicleYear",
      "plate",
      "phone",
      "capacity",
      "compartments",
      "city",
      "state",
      "notes",
      "rating",
      "employmentType",
    ];
    const data = Object.fromEntries(
      Object.entries(request.body || {}).filter(([key]) =>
        allowed.includes(key),
      ),
    );
    if (
      data.employmentType &&
      !["autonomous", "carrier"].includes(data.employmentType)
    )
      return response.status(400).json({ error: "Tipo de vínculo inválido" });
    const carrierId =
      typeof request.body?.carrierId === "string" ? request.body.carrierId : "";
    if (data.employmentType === "carrier" && !carrierId)
      return response
        .status(400)
        .json({ error: "Selecione a transportadora do motorista" });
    const driver = await prisma.$transaction(async (transaction) => {
      const updatedDriver = await transaction.driver.update({
        where: { id: request.params.driverId },
        data,
      });
      if (data.employmentType === "autonomous") {
        await transaction.driverCarrierLink.updateMany({
          where: { driverId: updatedDriver.id, endedAt: null },
          data: { endedAt: new Date(), status: "ended" },
        });
      } else if (data.employmentType === "carrier" && carrierId) {
        const company = await transaction.transportCompany.findUnique({
          where: { id: carrierId },
        });
        if (!company)
          throw new Error("A transportadora selecionada não está disponível");
        await transaction.driverCarrierLink.updateMany({
          where: { driverId: updatedDriver.id, endedAt: null },
          data: { endedAt: new Date(), status: "ended" },
        });
        await transaction.driverCarrierLink.create({
          data: { driverId: updatedDriver.id, companyId: company.id },
        });
      }
      return transaction.driver.findUnique({
        where: { id: updatedDriver.id },
        include: {
          carrierLinks: {
            where: { endedAt: null },
            include: { company: true },
            take: 1,
          },
        },
      });
    });
    broadcast("driver-updated");
    response.json({ driver: publicDriver(driver) });
  },
);

app.delete(
  "/api/admin/drivers/:driverId",
  auth,
  requireOperations,
  async (request, response) => {
    const driver = await prisma.driver.findUnique({
      where: { id: request.params.driverId },
    });
    if (!driver)
      return response.status(404).json({ error: "Motorista não encontrado" });
    await prisma.user.delete({ where: { id: driver.userId } });
    broadcast("driver-deleted");
    response.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Rotas de frete (FreightRoute): uma rota liga um posto de coleta a um
// cliente final e pode receber vários motoristas ao longo do tempo, mas cada
// motorista só pode manter um vínculo (assignment) ativo por vez, em
// qualquer rota do sistema.
// ---------------------------------------------------------------------------

const freightRouteStatuses = [
  "open",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
];
const freightRouteOpenStatuses = ["open", "assigned", "in_progress"];
const freightRouteAssignmentStatuses = ["active", "completed", "cancelled"];

const freightRouteInclude = {
  createdBy: true,
  collectionPoint: true,
  finalCustomer: true,
  assignments: {
    include: { driver: true, chatOffer: true },
    orderBy: { acceptedAt: "desc" },
  },
  chatOffers: {
    include: { driver: true, createdBy: true },
    orderBy: { createdAt: "desc" },
  },
};

const freightSettlementInclude = {
  assignment: {
    include: {
      driver: true,
      route: { include: { collectionPoint: true, finalCustomer: true } },
    },
  },
};

const ensureCompletedFreightSettlements = async (driverId) => {
  const assignments = await prisma.freightRouteAssignment.findMany({
    where: {
      status: "completed",
      ...(driverId ? { driverId } : {}),
    },
    select: { id: true, settlement: { select: { id: true } } },
  });
  for (const assignment of assignments) {
    if (!assignment.settlement) {
      await prisma.freightSettlement.upsert({
        where: { assignmentId: assignment.id },
        create: { assignmentId: assignment.id },
        update: {},
      });
    }
  }
};

const publicFreightSettlement = (settlement) => ({
  id: settlement.id,
  assignment_id: settlement.assignmentId,
  driver_claimed_amount_cents: settlement.driverClaimedAmountCents,
  confirmed_amount_cents: settlement.confirmedAmountCents,
  driver_notes: settlement.driverNotes,
  operations_notes: settlement.operationsNotes,
  payment_reference: settlement.paymentReference,
  payment_proof_file_name: settlement.paymentProofFileName,
  payment_proof_mime_type: settlement.paymentProofMimeType,
  has_payment_proof: Boolean(settlement.paymentProofDataBase64),
  status: settlement.status,
  approved_at: settlement.approvedAt?.toISOString() || null,
  paid_at: settlement.paidAt?.toISOString() || null,
  created_at: settlement.createdAt.toISOString(),
  updated_at: settlement.updatedAt.toISOString(),
  assignment: {
    id: settlement.assignment.id,
    status: settlement.assignment.status,
    accepted_at: settlement.assignment.acceptedAt.toISOString(),
    ended_at: settlement.assignment.endedAt?.toISOString() || null,
    driver: {
      id: settlement.assignment.driver.id,
      full_name: settlement.assignment.driver.fullName,
    },
    route: {
      id: settlement.assignment.route.id,
      distance_km: settlement.assignment.route.distanceKm,
      collection_point: publicOperationalLocation(
        settlement.assignment.route.collectionPoint,
      ),
      final_customer: publicOperationalLocation(
        settlement.assignment.route.finalCustomer,
      ),
    },
  },
});

const publicFreightChatOffer = (offer) => ({
  id: offer.id,
  route_id: offer.routeId,
  driver_id: offer.driverId,
  driver: offer.driver
    ? { id: offer.driver.id, full_name: offer.driver.fullName }
    : null,
  created_by: offer.createdBy ? publicUser(offer.createdBy) : null,
  amount_cents: offer.amountCents,
  status: offer.status,
  created_at: offer.createdAt.toISOString(),
  responded_at: offer.respondedAt?.toISOString() || null,
  accepted_assignment_id: offer.acceptedAssignmentId ?? null,
  route: offer.route
    ? {
        id: offer.route.id,
        distance_km: offer.route.distanceKm,
        collection_point: offer.route.collectionPoint
          ? publicOperationalLocation(offer.route.collectionPoint)
          : null,
        final_customer: offer.route.finalCustomer
          ? publicOperationalLocation(offer.route.finalCustomer)
          : null,
      }
    : null,
});

const publicFreightRoute = (route) => ({
  id: route.id,
  created_by_user_id: route.createdByUserId,
  created_by: route.createdBy ? publicUser(route.createdBy) : null,
  collection_point_id: route.collectionPointId,
  collection_point: route.collectionPoint
    ? publicOperationalLocation(route.collectionPoint)
    : null,
  final_customer_id: route.finalCustomerId,
  final_customer: route.finalCustomer
    ? publicOperationalLocation(route.finalCustomer)
    : null,
  distance_km: route.distanceKm,
  status: route.status,
  assignments: (route.assignments || []).map((assignment) => ({
    id: assignment.id,
    driver_id: assignment.driverId,
    driver: assignment.driver ? publicDriver(assignment.driver) : null,
    capacity: assignment.capacity,
    status: assignment.status,
    progress_status: assignment.progressStatus,
    accepted_at: assignment.acceptedAt.toISOString(),
    ended_at: assignment.endedAt?.toISOString() || null,
    collection_arrived_at:
      assignment.collectionArrivedAt?.toISOString() || null,
    collection_confirmed_at:
      assignment.collectionConfirmedAt?.toISOString() || null,
    customer_arrived_at: assignment.customerArrivedAt?.toISOString() || null,
    customer_confirmed_at:
      assignment.customerConfirmedAt?.toISOString() || null,
    chat_offer: assignment.chatOffer
      ? publicFreightChatOffer(assignment.chatOffer)
      : null,
  })),
  chat_offers: (route.chatOffers || []).map(publicFreightChatOffer),
  active_driver_count: (route.assignments || []).filter(
    (assignment) => assignment.status === "active",
  ).length,
  created_at: route.createdAt.toISOString(),
  updated_at: route.updatedAt.toISOString(),
});

const parseDateParam = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
};

const notifyNearestDriverForRoute = async ({ route, userId, amountCents }) => {
  const activeSince = new Date(Date.now() - 2 * 60 * 1000);
  const candidates = await prisma.driver.findMany({
    where: {
      isOnline: true,
      status: "available",
      lastSeen: { gte: activeSince },
      latitude: { not: null },
      longitude: { not: null },
      homologationStatus: "active",
      routeAssignments: { none: { status: "active" } },
    },
    select: {
      id: true,
      userId: true,
      fullName: true,
      latitude: true,
      longitude: true,
      capacity: true,
      vehicleAssignments: {
        where: { endedAt: null },
        include: { vehicle: { select: { capacity: true } } },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  });
  const previouslyOfferedDriverIds = new Set(
    route.chatOffers.map((offer) => offer.driverId),
  );
  const eligibleDrivers = candidates.filter(
    (driver) =>
      !previouslyOfferedDriverIds.has(driver.id) &&
      (driver.capacity?.trim() ||
        driver.vehicleAssignments?.[0]?.vehicle?.capacity?.trim()),
  );
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const distanceFromCollectionPoint = (driver) => {
    const latitudeDelta = toRadians(
      driver.latitude - route.collectionPoint.latitude,
    );
    const longitudeDelta = toRadians(
      driver.longitude - route.collectionPoint.longitude,
    );
    const originLatitude = toRadians(route.collectionPoint.latitude);
    const driverLatitude = toRadians(driver.latitude);
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(originLatitude) *
        Math.cos(driverLatitude) *
        Math.sin(longitudeDelta / 2) ** 2;
    return (
      6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  };
  const nearestDriver =
    eligibleDrivers
      .map((driver) => ({
        driver,
        distanceKm: distanceFromCollectionPoint(driver),
      }))
      .sort((first, second) => first.distanceKm - second.distanceKm)[0] ?? null;

  if (!nearestDriver)
    return {
      nearestDriver: null,
      notificationMessage:
        "Não há motorista online, homologado e disponível com GPS para receber a oferta.",
    };

  const amountText = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCents / 100);
  const bodyText = `Nova oferta de frete: ${route.collectionPoint.name} → ${route.finalCustomer.name}. Valor: ${amountText}. Você está a aproximadamente ${nearestDriver.distanceKm.toFixed(1)} km do posto de coleta.`;
  await prisma.$transaction(async (transaction) => {
    const offer = await transaction.freightChatOffer.create({
      data: {
        routeId: route.id,
        driverId: nearestDriver.driver.id,
        createdByUserId: userId,
        amountCents,
      },
    });
    await transaction.driverChatMessage.create({
      data: {
        driverId: nearestDriver.driver.id,
        userId,
        body: bodyText,
        freightOfferId: offer.id,
      },
    });
  });
  broadcast("nearest-driver-freight-offer", nearestDriver.driver.userId);
  return {
    nearestDriver,
    notificationMessage: `Oferta enviada para ${nearestDriver.driver.fullName}, motorista disponível mais próximo (${nearestDriver.distanceKm.toFixed(1)} km do posto).`,
  };
};

// Alerta persistido no chat de todos os motoristas homologados, independentemente do estado online.
const alertDriversAboutRoutes = async ({ routes, senderUserId, intro }) => {
  const drivers = await prisma.driver.findMany({
    where: { homologationStatus: "active" },
    select: { id: true, userId: true },
  });
  if (!drivers.length) return { driverCount: 0 };
  const lines = routes.slice(0, 8).map((route) => {
    const km = Number.isFinite(route.distanceKm)
      ? ` (${route.distanceKm.toFixed(0)} km)`
      : "";
    return `• ${route.collectionPoint.name} → ${route.finalCustomer.name}${km}`;
  });
  if (routes.length > 8) lines.push(`… e mais ${routes.length - 8} rota(s).`);
  const body =
    `${intro}\n${lines.join("\n")}\nFale com a operação para pegar a rota.`.slice(
      0,
      1000,
    );
  await prisma.driverChatMessage.createMany({
    data: drivers.map((driver) => ({
      driverId: driver.id,
      userId: senderUserId,
      body,
      kind: "route_alert",
    })),
  });
  for (const driver of drivers) broadcast("route-alert", driver.userId);
  return { driverCount: drivers.length };
};

const driverCountText = (count) =>
  count === 1 ? "1 motorista homologado" : `${count} motoristas homologados`;

// Início do dia em Brasília (UTC-3), para "rotas disponíveis do dia".
const startOfTodayInBrazil = () => {
  const local = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      3,
    ),
  );
};

app.post(
  "/api/freight-route-alerts/today",
  auth,
  requireOperations,
  async (request, response) => {
    const routes = await prisma.freightRoute.findMany({
      where: { status: "open", createdAt: { gte: startOfTodayInBrazil() } },
      include: freightRouteInclude,
      orderBy: { createdAt: "asc" },
    });
    if (!routes.length)
      return response
        .status(409)
        .json({ error: "Não há rotas disponíveis hoje para avisar" });
    const { driverCount } = await alertDriversAboutRoutes({
      routes,
      senderUserId: request.user.id,
      intro: `Rotas disponíveis hoje (${routes.length}):`,
    });
    response.json({
      route_count: routes.length,
      driver_count: driverCount,
      message: driverCount
        ? `Alerta com ${routes.length} rota(s) enviado para ${driverCountText(driverCount)}.`
        : "Nenhum motorista homologado para receber o alerta.",
    });
  },
);

app.post(
  "/api/freight-routes",
  auth,
  requireOperations,
  async (request, response) => {
    const body = request.body || {};
    const collectionPointId =
      typeof body.collectionPointId === "string" ? body.collectionPointId : "";
    const finalCustomerId =
      typeof body.finalCustomerId === "string" ? body.finalCustomerId : "";
    const notifyAllDrivers = body.notifyAllDrivers === true;

    if (!collectionPointId || !finalCustomerId) {
      return response.status(400).json({
        error: "Selecione o posto de coleta e o cliente final da rota",
      });
    }
    if (collectionPointId === finalCustomerId) {
      return response.status(400).json({
        error: "Posto de coleta e cliente final devem ser diferentes",
      });
    }

    const [collectionPoint, finalCustomer] = await Promise.all([
      prisma.operationalLocation.findUnique({
        where: { id: collectionPointId },
      }),
      prisma.operationalLocation.findUnique({ where: { id: finalCustomerId } }),
    ]);
    if (
      !collectionPoint ||
      collectionPoint.kind !== "collection_point" ||
      !collectionPoint.active
    ) {
      return response
        .status(400)
        .json({ error: "Posto de coleta inválido ou inativo" });
    }
    if (
      !finalCustomer ||
      finalCustomer.kind !== "final_customer" ||
      !finalCustomer.active
    ) {
      return response
        .status(400)
        .json({ error: "Cliente final inválido ou inativo" });
    }
    // Distância calculada pelos endereços, nunca digitada. Se não der para calcular, a rota é criada sem distância.
    const hasCoordinates = [collectionPoint, finalCustomer].every(
      (point) =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    );
    let distanceKm = null;
    if (hasCoordinates) {
      const coordinates = `${collectionPoint.longitude},${collectionPoint.latitude};${finalCustomer.longitude},${finalCustomer.latitude}`;
      const { body: routeBody } = await fetchOsrmRoute(
        coordinates,
        "overview=false&steps=false",
      );
      const calculatedDistance = routeBody?.routes?.[0]?.distance;
      if (
        routeBody?.code === "Ok" &&
        Number.isFinite(calculatedDistance) &&
        calculatedDistance > 0
      )
        distanceKm = calculatedDistance / 1000;
    }

    const route = await prisma.freightRoute.create({
      data: {
        createdByUserId: request.user.id,
        collectionPointId,
        finalCustomerId,
        distanceKm,
      },
      include: freightRouteInclude,
    });
    let notificationMessage = null;
    if (notifyAllDrivers) {
      try {
        const { driverCount } = await alertDriversAboutRoutes({
          routes: [route],
          senderUserId: request.user.id,
          intro: "Nova rota disponível:",
        });
        notificationMessage = driverCount
          ? `Rota criada e alerta enviado para ${driverCountText(driverCount)}.`
          : "Rota criada. Nenhum motorista homologado para receber o alerta.";
      } catch (error) {
        console.error("Falha ao enviar alerta da rota", error);
        notificationMessage =
          "Rota criada, mas não foi possível enviar o alerta aos motoristas.";
      }
    }
    broadcast("freight-route-created");
    response.status(201).json({
      route: publicFreightRoute(route),
      notification_message: notificationMessage,
    });
  },
);

app.post(
  "/api/freight-routes/:routeId/offers/nearest",
  auth,
  requireOperations,
  async (request, response) => {
    return response.status(410).json({
      error: "O envio de valores para motoristas foi desativado",
    });

    const route = await prisma.freightRoute.findUnique({
      where: { id: request.params.routeId },
      include: freightRouteInclude,
    });
    if (!route)
      return response.status(404).json({ error: "Rota não encontrada" });
    if (route.status !== "open")
      return response
        .status(409)
        .json({ error: "Só é possível enviar oferta para uma rota aberta" });
    if (route.chatOffers.some((offer) => offer.status === "offered"))
      return response.status(409).json({
        error: "Esta rota já tem uma oferta aguardando resposta",
      });

    const result = await notifyNearestDriverForRoute({
      route,
      userId: request.user.id,
      amountCents,
    });
    broadcast("freight-route-updated");
    const updatedRoute = result.nearestDriver
      ? await prisma.freightRoute.findUnique({
          where: { id: route.id },
          include: freightRouteInclude,
        })
      : route;
    response.status(201).json({
      route: publicFreightRoute(updatedRoute),
      notification_message: result.notificationMessage,
      notified_driver: result.nearestDriver
        ? {
            id: result.nearestDriver.driver.id,
            full_name: result.nearestDriver.driver.fullName,
            distance_km: result.nearestDriver.distanceKm,
          }
        : null,
    });
  },
);

app.get(
  "/api/freight-routes",
  auth,
  requireOperations,
  async (request, response) => {
    const status =
      typeof request.query.status === "string" ? request.query.status : "";
    const clientId =
      typeof request.query.clientId === "string" ? request.query.clientId : "";
    const driverId =
      typeof request.query.driverId === "string" ? request.query.driverId : "";
    const from = parseDateParam(request.query.from);
    const to = parseDateParam(request.query.to);
    if (status && !freightRouteStatuses.includes(status))
      return response.status(400).json({ error: "Status de rota inválido" });
    if (from === undefined || to === undefined)
      return response.status(400).json({ error: "Datas de filtro inválidas" });

    const where = {
      ...(status ? { status } : {}),
      ...(clientId
        ? {
            OR: [
              { collectionPointId: clientId },
              { finalCustomerId: clientId },
            ],
          }
        : {}),
      ...(driverId ? { assignments: { some: { driverId } } } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    const routes = await prisma.freightRoute.findMany({
      where,
      include: freightRouteInclude,
      orderBy: { createdAt: "desc" },
    });
    response.json({ routes: routes.map(publicFreightRoute) });
  },
);

app.get(
  "/api/freight-routes/reports",
  auth,
  requireOperations,
  async (request, response) => {
    const clientId =
      typeof request.query.clientId === "string" ? request.query.clientId : "";
    const driverId =
      typeof request.query.driverId === "string" ? request.query.driverId : "";
    const from = parseDateParam(request.query.from);
    const to = parseDateParam(request.query.to);
    if (from === undefined || to === undefined)
      return response.status(400).json({ error: "Datas de filtro inválidas" });

    const where = {
      ...(clientId
        ? {
            OR: [
              { collectionPointId: clientId },
              { finalCustomerId: clientId },
            ],
          }
        : {}),
      ...(driverId ? { assignments: { some: { driverId } } } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    const routes = await prisma.freightRoute.findMany({
      where,
      include: freightRouteInclude,
      orderBy: { createdAt: "desc" },
    });

    const statusBreakdown = {};
    const byDriver = new Map();
    const byClient = new Map();
    let totalDistanceKm = 0;

    for (const route of routes) {
      statusBreakdown[route.status] = (statusBreakdown[route.status] || 0) + 1;
      totalDistanceKm += route.distanceKm || 0;

      for (const location of [route.collectionPoint, route.finalCustomer]) {
        if (!location) continue;
        const entry = byClient.get(location.id) || {
          location_id: location.id,
          name: location.name,
          route_count: 0,
        };
        entry.route_count += 1;
        byClient.set(location.id, entry);
      }

      const relevantAssignments = driverId
        ? route.assignments.filter(
            (assignment) => assignment.driverId === driverId,
          )
        : route.assignments;
      for (const assignment of relevantAssignments) {
        if (!assignment.driver) continue;
        const entry = byDriver.get(assignment.driverId) || {
          driver_id: assignment.driverId,
          name: assignment.driver.fullName,
          route_count: 0,
        };
        entry.route_count += 1;
        byDriver.set(assignment.driverId, entry);
      }
    }

    response.json({
      routes: routes.map(publicFreightRoute),
      summary: {
        total_routes: routes.length,
        total_distance_km: totalDistanceKm,
        status_breakdown: statusBreakdown,
        by_driver: [...byDriver.values()].sort(
          (a, b) => b.route_count - a.route_count,
        ),
        by_client: [...byClient.values()].sort(
          (a, b) => b.route_count - a.route_count,
        ),
      },
    });
  },
);

app.get(
  "/api/freight-routes/dashboard",
  auth,
  requireOperations,
  async (_request, response) => {
    const [routes, statusGroups] = await Promise.all([
      prisma.freightRoute.findMany({
        include: freightRouteInclude,
        orderBy: { createdAt: "desc" },
      }),
      prisma.freightRoute.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const statusBreakdown = Object.fromEntries(
      statusGroups.map((group) => [group.status, group._count._all]),
    );
    const totalDistanceKm = routes.reduce(
      (sum, route) => sum + (route.distanceKm || 0),
      0,
    );

    const byDriver = new Map();
    const byClient = new Map();
    const perDay = new Map();
    const fourteenDaysAgo = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);
    fourteenDaysAgo.setHours(0, 0, 0, 0);

    for (const route of routes) {
      for (const location of [route.collectionPoint, route.finalCustomer]) {
        if (!location) continue;
        const entry = byClient.get(location.id) || {
          location_id: location.id,
          name: location.name,
          route_count: 0,
        };
        entry.route_count += 1;
        byClient.set(location.id, entry);
      }
      for (const assignment of route.assignments) {
        if (!assignment.driver) continue;
        const entry = byDriver.get(assignment.driverId) || {
          driver_id: assignment.driverId,
          name: assignment.driver.fullName,
          route_count: 0,
        };
        entry.route_count += 1;
        byDriver.set(assignment.driverId, entry);
      }
      if (route.createdAt >= fourteenDaysAgo) {
        const day = route.createdAt.toISOString().slice(0, 10);
        perDay.set(day, (perDay.get(day) || 0) + 1);
      }
    }

    const dailySeries = [];
    for (let index = 0; index < 14; index += 1) {
      const day = new Date(
        fourteenDaysAgo.getTime() + index * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);
      dailySeries.push({ date: day, count: perDay.get(day) || 0 });
    }

    response.json({
      total_routes: routes.length,
      active_routes: freightRouteOpenStatuses.reduce(
        (sum, key) => sum + (statusBreakdown[key] || 0),
        0,
      ),
      completed_routes: statusBreakdown.completed || 0,
      cancelled_routes: statusBreakdown.cancelled || 0,
      total_distance_km: totalDistanceKm,
      status_breakdown: statusBreakdown,
      top_drivers: [...byDriver.values()]
        .sort((a, b) => b.route_count - a.route_count)
        .slice(0, 5),
      top_clients: [...byClient.values()]
        .sort((a, b) => b.route_count - a.route_count)
        .slice(0, 5),
      daily_series: dailySeries,
    });
  },
);

app.get(
  "/api/freight-routes/:routeId",
  auth,
  requireOperations,
  async (request, response) => {
    const route = await prisma.freightRoute.findUnique({
      where: { id: request.params.routeId },
      include: freightRouteInclude,
    });
    if (!route)
      return response.status(404).json({ error: "Rota não encontrada" });
    response.json({ route: publicFreightRoute(route) });
  },
);

app.patch(
  "/api/freight-routes/:routeId",
  auth,
  requireOperations,
  async (request, response) => {
    const route = await prisma.freightRoute.findUnique({
      where: { id: request.params.routeId },
    });
    if (!route)
      return response.status(404).json({ error: "Rota não encontrada" });
    const body = request.body || {};
    const data = {};
    // distanceKm não é editável manualmente: sempre derivado das coordenadas do posto de coleta e do cliente final.
    if (typeof body.status === "string") {
      if (!freightRouteStatuses.includes(body.status))
        return response.status(400).json({ error: "Status de rota inválido" });
      if (["completed", "cancelled"].includes(route.status))
        return response.status(409).json({
          error: "Rotas concluídas ou canceladas não podem ser alteradas",
        });
      if (body.status === "completed") {
        const activeAssignments = await prisma.freightRouteAssignment.count({
          where: { routeId: route.id, status: "active" },
        });
        if (activeAssignments > 0)
          return response.status(409).json({
            error:
              "Confirme a chegada ao cliente final de cada motorista antes de concluir a rota",
          });
      }
      data.status = body.status;
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const updatedRoute = await transaction.freightRoute.update({
        where: { id: route.id },
        data,
      });
      if (["completed", "cancelled"].includes(data.status)) {
        await transaction.freightRouteAssignment.updateMany({
          where: { routeId: route.id, status: "active" },
          data: {
            status: data.status === "completed" ? "completed" : "cancelled",
            endedAt: new Date(),
          },
        });
      }
      return transaction.freightRoute.findUnique({
        where: { id: route.id },
        include: freightRouteInclude,
      });
    });
    broadcast("freight-route-updated");
    response.json({ route: publicFreightRoute(updated) });
  },
);

app.post(
  "/api/freight-routes/:routeId/assign",
  auth,
  requireOperations,
  async (request, response) => {
    const route = await prisma.freightRoute.findUnique({
      where: { id: request.params.routeId },
    });
    if (!route)
      return response.status(404).json({ error: "Rota não encontrada" });
    if (!freightRouteOpenStatuses.includes(route.status))
      return response
        .status(409)
        .json({ error: "Esta rota não aceita novos motoristas" });

    const body = request.body || {};
    const driverId = typeof body.driverId === "string" ? body.driverId : "";
    if (!driverId)
      return response.status(400).json({ error: "Motorista é obrigatório" });

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        vehicleAssignments: {
          where: { endedAt: null },
          include: { vehicle: true },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!driver)
      return response.status(404).json({ error: "Motorista não encontrado" });
    if (driver.homologationStatus !== "active")
      return response.status(409).json({
        error: "Motorista precisa estar homologado para assumir rotas",
      });

    // Capacidade sempre vem do cadastro do motorista (ou do veículo vinculado a ele), nunca digitada manualmente pelo despachante.
    const capacity =
      driver.capacity?.trim() ||
      driver.vehicleAssignments?.[0]?.vehicle?.capacity?.trim() ||
      "";
    if (!capacity)
      return response.status(409).json({
        error:
          "Motorista não possui capacidade cadastrada. Atualize o cadastro antes de vinculá-lo à rota",
      });

    try {
      const assignment = await prisma.$transaction(async (transaction) => {
        const existingActive =
          await transaction.freightRouteAssignment.findFirst({
            where: { driverId, status: "active" },
          });
        if (existingActive) throw new Error("EXISTING_ACTIVE_ROUTE");
        const created = await transaction.freightRouteAssignment.create({
          data: { routeId: route.id, driverId, capacity },
        });
        await transaction.freightRoute.update({
          where: { id: route.id },
          data: { status: route.status === "open" ? "assigned" : route.status },
        });
        return created;
      });
      broadcast("freight-route-assigned");
      const updated = await prisma.freightRoute.findUnique({
        where: { id: route.id },
        include: freightRouteInclude,
      });
      response.status(201).json({
        route: publicFreightRoute(updated),
        assignment_id: assignment.id,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "EXISTING_ACTIVE_ROUTE") {
        return response.status(409).json({
          error: "Este motorista já possui uma rota ativa no momento",
        });
      }
      response
        .status(400)
        .json({ error: "Não foi possível vincular o motorista a esta rota" });
    }
  },
);

app.patch(
  "/api/freight-routes/:routeId/assignments/:assignmentId",
  auth,
  async (request, response) => {
    const assignment = await prisma.freightRouteAssignment.findFirst({
      where: {
        id: request.params.assignmentId,
        routeId: request.params.routeId,
      },
      include: { chatOffer: true },
    });
    if (!assignment)
      return response
        .status(404)
        .json({ error: "Vínculo de rota não encontrado" });
    const isSelfDriver = request.user.driver?.id === assignment.driverId;
    if (!isSelfDriver && !isOperationsUser(request))
      return response
        .status(403)
        .json({ error: "Você não participa deste vínculo de rota" });
    if (assignment.status !== "active")
      return response
        .status(409)
        .json({ error: "Este vínculo já foi encerrado" });

    const status = request.body?.status;
    if (status === "completed")
      return response.status(409).json({
        error:
          "Conclua o frete após a operação confirmar a chegada ao cliente final",
      });
    if (status !== "cancelled")
      return response
        .status(400)
        .json({ error: "Somente o cancelamento está disponível nesta ação" });

    await prisma.freightRouteAssignment.update({
      where: { id: assignment.id },
      data: { status, endedAt: new Date() },
    });
    if (status === "completed") {
      const completedAt = new Date();
      if (assignment.chatOffer) {
        await prisma.freightChatOffer.update({
          where: { id: assignment.chatOffer.id },
          data: { status: "completed", respondedAt: completedAt },
        });
      }
      await prisma.freightSettlement.upsert({
        where: { assignmentId: assignment.id },
        create: assignment.chatOffer
          ? {
              assignmentId: assignment.id,
              driverClaimedAmountCents: assignment.chatOffer.amountCents,
              confirmedAmountCents: assignment.chatOffer.amountCents,
              status: "approved",
              approvedAt: completedAt,
            }
          : { assignmentId: assignment.id },
        update: {},
      });
    }
    const route = await prisma.freightRoute.findUnique({
      where: { id: assignment.routeId },
      include: freightRouteInclude,
    });
    const stillActive = route.assignments.some(
      (item) => item.status === "active",
    );
    if (!stillActive && ["assigned", "in_progress"].includes(route.status)) {
      await prisma.freightRoute.update({
        where: { id: route.id },
        data: { status: status === "completed" ? "completed" : "open" },
      });
    }
    broadcast("freight-route-assignment-updated");
    const updated = await prisma.freightRoute.findUnique({
      where: { id: assignment.routeId },
      include: freightRouteInclude,
    });
    response.json({ route: publicFreightRoute(updated) });
  },
);

app.patch(
  "/api/freight-routes/:routeId/assignments/:assignmentId/progress",
  auth,
  async (request, response) => {
    const assignment = await prisma.freightRouteAssignment.findFirst({
      where: {
        id: request.params.assignmentId,
        routeId: request.params.routeId,
      },
      include: { chatOffer: true },
    });
    if (!assignment)
      return response
        .status(404)
        .json({ error: "Vínculo de rota não encontrado" });
    if (assignment.status !== "active")
      return response.status(409).json({ error: "Este frete não está ativo" });

    const driverActions = {
      start_collection: { from: "assigned", to: "en_route_collection" },
      arrive_collection: {
        from: "en_route_collection",
        to: "awaiting_collection_confirmation",
        timestamp: "collectionArrivedAt",
      },
      start_customer: {
        from: "collection_confirmed",
        to: "en_route_customer",
      },
      arrive_customer: {
        from: "en_route_customer",
        to: "awaiting_customer_confirmation",
        timestamp: "customerArrivedAt",
      },
    };
    const operationActions = {
      confirm_collection: {
        from: "awaiting_collection_confirmation",
        to: "collection_confirmed",
        timestamp: "collectionConfirmedAt",
      },
      confirm_customer: {
        from: "awaiting_customer_confirmation",
        to: "completed",
        timestamp: "customerConfirmedAt",
      },
    };
    const action = request.body?.action;
    const transition = driverActions[action] ?? operationActions[action];
    if (!transition)
      return response.status(400).json({ error: "Etapa de frete inválida" });

    const isSelfDriver = request.user.driver?.id === assignment.driverId;
    const isOperations = isOperationsUser(request);
    if (driverActions[action] && !isSelfDriver)
      return response.status(403).json({
        error: "Somente o motorista deste frete pode atualizar esta etapa",
      });
    if (operationActions[action] && !isOperations)
      return response.status(403).json({
        error: "Somente operação ou administrador pode confirmar a chegada",
      });
    if (assignment.progressStatus !== transition.from)
      return response.status(409).json({
        error: "Esta etapa não pode ser registrada antes da etapa anterior",
      });

    const now = new Date();
    const data = { progressStatus: transition.to };
    if (transition.timestamp) data[transition.timestamp] = now;
    if (action === "confirm_customer") {
      data.status = "completed";
      data.endedAt = now;
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const updatedAssignment = await transaction.freightRouteAssignment.update(
        {
          where: { id: assignment.id },
          data,
        },
      );
      if (action === "start_collection") {
        await transaction.freightRoute.update({
          where: { id: assignment.routeId },
          data: { status: "in_progress" },
        });
      }
      if (action === "confirm_customer") {
        if (assignment.chatOffer) {
          await transaction.freightChatOffer.update({
            where: { id: assignment.chatOffer.id },
            data: { status: "completed", respondedAt: now },
          });
        }
        await transaction.freightSettlement.upsert({
          where: { assignmentId: assignment.id },
          create: assignment.chatOffer
            ? {
                assignmentId: assignment.id,
                driverClaimedAmountCents: assignment.chatOffer.amountCents,
                confirmedAmountCents: assignment.chatOffer.amountCents,
                status: "approved",
                approvedAt: now,
              }
            : { assignmentId: assignment.id },
          update: {},
        });
        const activeAssignments =
          await transaction.freightRouteAssignment.count({
            where: { routeId: assignment.routeId, status: "active" },
          });
        if (activeAssignments === 0) {
          await transaction.freightRoute.update({
            where: { id: assignment.routeId },
            data: { status: "completed" },
          });
        }
      }
      return updatedAssignment;
    });

    broadcast(`freight-progress-${action}`);
    const route = await prisma.freightRoute.findUnique({
      where: { id: assignment.routeId },
      include: freightRouteInclude,
    });
    response.json({
      assignment: {
        id: updated.id,
        status: updated.status,
        progress_status: updated.progressStatus,
        collection_arrived_at:
          updated.collectionArrivedAt?.toISOString() || null,
        collection_confirmed_at:
          updated.collectionConfirmedAt?.toISOString() || null,
        customer_arrived_at: updated.customerArrivedAt?.toISOString() || null,
        customer_confirmed_at:
          updated.customerConfirmedAt?.toISOString() || null,
      },
      route: publicFreightRoute(route),
    });
  },
);

// Dashboard do motorista: somente as rotas atribuídas a ele mesmo (nunca a lista geral de rotas).
app.get("/api/driver/routes", auth, async (request, response) => {
  if (!request.user.driver)
    return response
      .status(404)
      .json({ error: "Motorista ainda não cadastrado" });
  const driverId = request.user.driver.id;
  const routes = await prisma.freightRoute.findMany({
    where: { assignments: { some: { driverId } } },
    include: freightRouteInclude,
    orderBy: { updatedAt: "desc" },
  });
  response.json({
    routes: routes.map((route) => {
      const mine =
        route.assignments.find(
          (assignment) => assignment.driverId === driverId,
        ) || null;
      return {
        ...publicFreightRoute(route),
        my_assignment: mine
          ? {
              id: mine.id,
              capacity: mine.capacity,
              status: mine.status,
              progress_status: mine.progressStatus,
              collection_arrived_at:
                mine.collectionArrivedAt?.toISOString() || null,
              collection_confirmed_at:
                mine.collectionConfirmedAt?.toISOString() || null,
              customer_arrived_at:
                mine.customerArrivedAt?.toISOString() || null,
              customer_confirmed_at:
                mine.customerConfirmedAt?.toISOString() || null,
            }
          : null,
      };
    }),
  });
});

app.get(
  "/api/freight-routes/:routeId/assignments/:assignmentId/chat-history",
  auth,
  async (request, response) => {
    const assignment = await prisma.freightRouteAssignment.findFirst({
      where: {
        id: request.params.assignmentId,
        routeId: request.params.routeId,
      },
    });
    if (!assignment)
      return response
        .status(404)
        .json({ error: "Vínculo de frete não encontrado" });
    const isAssignmentDriver = request.user.driver?.id === assignment.driverId;
    if (!isAssignmentDriver && !isOperationsUser(request))
      return response
        .status(403)
        .json({ error: "Acesso ao histórico deste frete não autorizado" });
    const messages = await prisma.driverChatMessage.findMany({
      where: {
        driverId: assignment.driverId,
        OR: [
          {
            createdAt: {
              gte: assignment.acceptedAt,
              lte: assignment.endedAt ?? new Date(),
            },
          },
          { freightOffer: { is: { routeId: assignment.routeId } } },
        ],
      },
      include: {
        sender: { select: { id: true, fullName: true, email: true } },
        freightOffer: {
          select: { id: true, amountCents: true, status: true },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    response.json({
      messages: messages.map((message) => ({
        id: message.id,
        body: message.body,
        created_at: message.createdAt.toISOString(),
        user: {
          id: message.sender.id,
          full_name: message.sender.fullName,
          email: message.sender.email,
        },
        freight_offer: message.freightOffer
          ? {
              id: message.freightOffer.id,
              amount_cents: message.freightOffer.amountCents,
              status: message.freightOffer.status,
            }
          : null,
      })),
    });
  },
);

app.get("/api/driver/freight-settlements", auth, async (request, response) => {
  const driverId = request.user.driver?.id;
  if (!driverId)
    return response
      .status(404)
      .json({ error: "Motorista ainda não cadastrado" });
  await ensureCompletedFreightSettlements(driverId);
  const settlements = await prisma.freightSettlement.findMany({
    where: { assignment: { driverId, status: "completed" } },
    include: freightSettlementInclude,
    orderBy: { updatedAt: "desc" },
  });
  response.json({ settlements: settlements.map(publicFreightSettlement) });
});

app.patch(
  "/api/driver/freight-settlements/:settlementId",
  auth,
  async (request, response) => {
    const driverId = request.user.driver?.id;
    if (!driverId)
      return response
        .status(404)
        .json({ error: "Motorista ainda não cadastrado" });
    const settlement = await prisma.freightSettlement.findUnique({
      where: { id: request.params.settlementId },
      include: { assignment: true },
    });
    if (!settlement || settlement.assignment.driverId !== driverId)
      return response.status(404).json({ error: "Acerto não encontrado" });
    if (settlement.status !== "pending")
      return response
        .status(409)
        .json({ error: "O valor não pode mais ser alterado neste acerto" });

    const claimedAmountCents = request.body?.claimedAmountCents;
    const driverNotes = request.body?.driverNotes;
    if (!Number.isSafeInteger(claimedAmountCents) || claimedAmountCents <= 0)
      return response
        .status(400)
        .json({ error: "Informe um valor válido em centavos" });
    if (driverNotes !== undefined && typeof driverNotes !== "string")
      return response.status(400).json({ error: "Observação inválida" });

    const updated = await prisma.freightSettlement.update({
      where: { id: settlement.id },
      data: {
        driverClaimedAmountCents: claimedAmountCents,
        driverNotes: driverNotes?.trim().slice(0, 1000) || null,
      },
      include: freightSettlementInclude,
    });
    broadcast("freight-settlement-updated");
    response.json({ settlement: publicFreightSettlement(updated) });
  },
);

app.get(
  "/api/freight-settlements",
  auth,
  requireOperations,
  async (request, response) => {
    await ensureCompletedFreightSettlements();
    const status = request.query.status;
    const settlements = await prisma.freightSettlement.findMany({
      where: {
        ...(typeof status === "string" &&
        ["pending", "approved", "paid"].includes(status)
          ? { status }
          : {}),
      },
      include: freightSettlementInclude,
      orderBy: { updatedAt: "desc" },
    });
    response.json({ settlements: settlements.map(publicFreightSettlement) });
  },
);

app.patch(
  "/api/freight-settlements/:settlementId",
  auth,
  requireOperations,
  async (request, response) => {
    const settlement = await prisma.freightSettlement.findUnique({
      where: { id: request.params.settlementId },
    });
    if (!settlement)
      return response.status(404).json({ error: "Acerto não encontrado" });

    const body = request.body || {};
    const nextStatus = body.status ?? settlement.status;
    const validStatuses = ["pending", "approved", "paid"];
    if (!validStatuses.includes(nextStatus))
      return response.status(400).json({ error: "Status de acerto inválido" });
    const statusRank = { pending: 0, approved: 1, paid: 2 };
    if (statusRank[nextStatus] < statusRank[settlement.status])
      return response
        .status(409)
        .json({ error: "O status do acerto não pode retroceder" });

    const confirmedAmountCents =
      body.confirmedAmountCents ?? settlement.confirmedAmountCents;
    if (
      confirmedAmountCents !== null &&
      (!Number.isSafeInteger(confirmedAmountCents) || confirmedAmountCents <= 0)
    )
      return response
        .status(400)
        .json({ error: "Informe um valor confirmado válido em centavos" });
    if (["approved", "paid"].includes(nextStatus) && !confirmedAmountCents)
      return response
        .status(400)
        .json({ error: "Confirme o valor antes de aprovar ou pagar" });
    if (
      nextStatus === "paid" &&
      settlement.status !== "approved" &&
      settlement.status !== "paid"
    )
      return response
        .status(409)
        .json({ error: "Aprove o acerto antes de registrar o pagamento" });
    if (
      settlement.status === "paid" &&
      confirmedAmountCents !== settlement.confirmedAmountCents
    )
      return response
        .status(409)
        .json({ error: "O valor de um acerto pago não pode ser alterado" });

    const optionalTextFields = ["operationsNotes", "paymentReference"];
    for (const field of optionalTextFields) {
      if (body[field] !== undefined && typeof body[field] !== "string")
        return response
          .status(400)
          .json({ error: "Dados do pagamento inválidos" });
    }

    let paymentProofData = null;
    if (body.paymentProof !== undefined) {
      const proof = body.paymentProof;
      const supportedMimeTypes = ["application/pdf", "image/jpeg", "image/png"];
      if (
        !proof ||
        typeof proof !== "object" ||
        typeof proof.fileName !== "string" ||
        typeof proof.mimeType !== "string" ||
        typeof proof.dataBase64 !== "string" ||
        !supportedMimeTypes.includes(proof.mimeType)
      )
        return response.status(400).json({
          error: "Anexe um comprovante em PDF, JPEG ou PNG",
        });
      const normalizedBase64 = proof.dataBase64.replace(/\s/g, "");
      const proofBytes = Buffer.from(normalizedBase64, "base64");
      const canonicalBase64 = proofBytes.toString("base64").replace(/=+$/, "");
      if (
        !proofBytes.length ||
        proofBytes.length > 8 * 1024 * 1024 ||
        canonicalBase64 !== normalizedBase64.replace(/=+$/, "")
      )
        return response.status(400).json({
          error: "O comprovante está vazio, inválido ou excede 8 MB",
        });
      const validFileSignature = {
        "application/pdf": proofBytes.subarray(0, 5).toString() === "%PDF-",
        "image/jpeg":
          proofBytes[0] === 0xff &&
          proofBytes[1] === 0xd8 &&
          proofBytes[2] === 0xff,
        "image/png": proofBytes
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          ),
      }[proof.mimeType];
      if (!validFileSignature)
        return response.status(400).json({
          error: "O conteúdo do arquivo não corresponde ao formato informado",
        });
      paymentProofData = {
        paymentProofFileName: proof.fileName
          .replace(/[\\/:*?"<>|\r\n]/g, "_")
          .trim()
          .slice(0, 180),
        paymentProofMimeType: proof.mimeType,
        paymentProofDataBase64: normalizedBase64,
      };
    }

    const now = new Date();
    const updated = await prisma.freightSettlement.update({
      where: { id: settlement.id },
      data: {
        confirmedAmountCents,
        status: nextStatus,
        operationsNotes:
          body.operationsNotes === undefined
            ? settlement.operationsNotes
            : body.operationsNotes.trim().slice(0, 1000) || null,
        paymentReference:
          body.paymentReference === undefined
            ? settlement.paymentReference
            : body.paymentReference.trim().slice(0, 160) || null,
        ...(paymentProofData ?? {}),
        approvedAt:
          nextStatus === "approved"
            ? (settlement.approvedAt ?? now)
            : settlement.approvedAt,
        paidAt:
          nextStatus === "paid"
            ? (settlement.paidAt ?? now)
            : settlement.paidAt,
      },
      include: freightSettlementInclude,
    });
    broadcast("freight-settlement-updated");
    response.json({ settlement: publicFreightSettlement(updated) });
  },
);

app.get(
  "/api/freight-settlements/:settlementId/proof",
  auth,
  async (request, response) => {
    const settlement = await prisma.freightSettlement.findUnique({
      where: { id: request.params.settlementId },
      select: {
        paymentProofFileName: true,
        paymentProofMimeType: true,
        paymentProofDataBase64: true,
        assignment: { select: { driverId: true } },
      },
    });
    if (!settlement || !settlement.paymentProofDataBase64)
      return response.status(404).json({ error: "Comprovante não encontrado" });
    if (
      !isOperationsUser(request) &&
      request.user.driver?.id !== settlement.assignment.driverId
    )
      return response
        .status(403)
        .json({ error: "Acesso ao comprovante não autorizado" });
    const fileName = settlement.paymentProofFileName || "comprovante-pagamento";
    response.setHeader(
      "Content-Type",
      settlement.paymentProofMimeType || "application/octet-stream",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/"/g, "_")}"`,
    );
    response.send(Buffer.from(settlement.paymentProofDataBase64, "base64"));
  },
);

const distPath = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (request, response, next) => {
    if (request.path.startsWith("/api")) return next();
    response.sendFile(path.join(distPath, "index.html"));
  });
}

// Rede de segurança: qualquer erro não tratado em rota /api deve virar JSON, nunca a página HTML padrão do Express.
app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  console.error(error);
  if (request.path.startsWith("/api")) {
    return response.status(500).json({ error: "Erro interno do servidor" });
  }
  next(error);
});

await ensureSystemAdmin();
await normalizeStoredDocuments();

const server = app.listen(port, "0.0.0.0", () =>
  console.log(`API listening on ${port}`),
);
const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
