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

app.use(express.json({ limit: "32kb" }));
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
    console.warn("ADMIN_PASSWORD is missing or too short. System admin bootstrap skipped.");
    return;
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
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { profile: true, driver: true } });
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
  city: driver.city,
  state: driver.state,
  is_online: driver.isOnline,
  latitude: driver.latitude,
  longitude: driver.longitude,
  last_seen: driver.lastSeen?.toISOString() || null,
  status: driver.status,
  notes: driver.notes,
  availability_since: driver.availabilitySince?.toISOString() || null,
  rating: driver.rating,
  total_trips: driver.totalTrips,
  created_at: driver.createdAt.toISOString(),
});

app.get("/api/health", (_request, response) => response.json({ ok: true }));

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
  const user = await prisma.user.findUnique({ where: { email }, include: { profile: true, driver: true } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return response.status(401).json({ error: "E-mail ou senha inválidos" });
  if (!user.profile?.approved) return response.status(403).json({ error: "Conta aguardando aprovação do administrador" });
  response.json({ access_token: encodeToken({ sub: user.id }), user: publicUser(user), profile: user.profile });
});

app.post("/api/auth/signup", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const fullName = typeof request.body?.fullName === "string" ? request.body.fullName.trim() : "";
  const phone = typeof request.body?.phone === "string" ? request.body.phone.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const requestedRole = ["driver", "operator"].includes(request.body?.requestedRole) ? request.body.requestedRole : "driver";
  const registrationNotes = typeof request.body?.registrationNotes === "string" ? request.body.registrationNotes.trim().slice(0, 1000) : null;
  if (!email || !fullName || !phone || password.length < 6) return response.status(400).json({ error: "Nome, e-mail, telefone e senha válida são obrigatórios" });
  try {
    const passwordHash = await hashPassword(password);
    await prisma.user.create({ data: { email, fullName, phone, passwordHash, profile: { create: { fullName, role: "driver", requestedRole, registrationNotes, approved: false } } } });
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

app.get("/api/admin/pending-users", auth, requireOperations, async (_request, response) => {
  const profiles = await prisma.profile.findMany({
    where: { approved: false, approvalClosed: false },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  response.json({ users: profiles.map((profile) => ({ id: profile.userId, profile_id: profile.id, full_name: profile.fullName, email: profile.user.email, phone: profile.user.phone, role: profile.role, requested_role: profile.requestedRole, registration_notes: profile.registrationNotes, created_at: profile.createdAt.toISOString() })) });
});

app.get("/api/admin/registration-requests", auth, requireAdmin, async (_request, response) => {
  const profiles = await prisma.profile.findMany({
    where: { approved: false },
    include: { user: true },
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

app.patch("/api/admin/users/:userId/approve", auth, requireOperations, async (request, response) => {
  const assignedRole = ["driver", "operator", "admin"].includes(request.body?.role) ? request.body.role : null;
  if (!assignedRole) return response.status(400).json({ error: "Informe um perfil válido" });
  const user = await prisma.user.findUnique({ where: { id: request.params.userId }, include: { profile: true, driver: true } });
  if (!user?.profile) return response.status(404).json({ error: "Cadastro não encontrado" });
  if (user.profile.approvalClosed) return response.status(400).json({ error: "Reabra a solicitação antes de aprovar" });
  if (!user.fullName?.trim() || !user.email?.trim() || !user.phone?.trim()) {
    return response.status(400).json({ error: "Nome, e-mail e telefone do cadastro são obrigatórios" });
  }
  const driverData = request.body?.driver || {};
  const requiredDriverFields = ["fullName", "phone", "vehicleModel", "plate", "city", "state", "capacity", "compartments"];
  if (assignedRole === "driver" && requiredDriverFields.some((field) => typeof driverData[field] !== "string" || !driverData[field].trim())) {
    return response.status(400).json({ error: "Preencha todos os campos obrigatórios do motorista antes de aprovar" });
  }
  const profile = await prisma.$transaction(async (transaction) => {
    const updatedProfile = await transaction.profile.update({ where: { userId: request.params.userId }, data: { approved: true, role: assignedRole } });
    if (assignedRole === "driver" && !user.driver) {
      await transaction.driver.create({ data: { userId: user.id, fullName: driverData.fullName.trim(), email: user.email, phone: driverData.phone.trim(), vehicleModel: driverData.vehicleModel.trim(), plate: driverData.plate.trim(), city: driverData.city.trim(), state: driverData.state.trim(), capacity: driverData.capacity.trim(), compartments: driverData.compartments.trim() } });
    } else if (assignedRole === "driver" && user.driver) {
      await transaction.driver.update({ where: { id: user.driver.id }, data: { fullName: driverData.fullName.trim(), email: user.email, phone: driverData.phone.trim(), vehicleModel: driverData.vehicleModel.trim(), plate: driverData.plate.trim(), city: driverData.city.trim(), state: driverData.state.trim(), capacity: driverData.capacity.trim(), compartments: driverData.compartments.trim() } });
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
  const allowed = ["fullName", "cpf", "phone", "email", "vehicleModel", "vehicleYear", "capacity", "compartments", "plate", "cnh", "city", "state", "notes"];
  const data = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  const driver = await prisma.driver.update({ where: { id: request.user.driver.id }, data });
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
  const validStatuses = ["offline", "available", "awaiting_loading", "awaiting_documents", "in_transit", "awaiting_unloading", "in_negotiation", "on_trip"];
  if (typeof isOnline !== "boolean" || !validStatuses.includes(status)) return response.status(400).json({ error: "Status inválido" });
  const driver = await prisma.driver.update({ where: { id: request.user.driver.id }, data: { isOnline, status, notes, lastSeen: new Date(), availabilitySince: isOnline ? new Date() : request.user.driver.availabilitySince } });
  broadcast("driver-status");
  response.json({ driver: publicDriver(driver) });
});

app.get("/api/drivers", auth, async (request, response) => {
  if (!['operator', 'admin'].includes(request.user.profile?.role)) return response.status(403).json({ error: "Acesso não permitido" });
  const activeSince = new Date(Date.now() - 2 * 60 * 1000);
  const drivers = await prisma.driver.findMany({ where: { isOnline: true, lastSeen: { gte: activeSince } }, orderBy: { availabilitySince: "asc" } });
  response.json({ drivers: drivers.map(publicDriver) });
});

app.get("/api/operations/directory", auth, requireOperations, async (request, response) => {
  const activeSince = new Date(Date.now() - 2 * 60 * 1000);
  const drivers = await prisma.driver.findMany({
    where: { isOnline: true, lastSeen: { gte: activeSince } },
    orderBy: { availabilitySince: "asc" },
  });
  const allDrivers = request.user.profile?.role === "admin"
    ? await prisma.driver.findMany({ orderBy: { fullName: "asc" } })
    : [];
  const operators = request.user.profile?.role === "admin"
    ? await prisma.user.findMany({
      where: { profile: { role: "operator", approved: true } },
      include: { profile: true },
      orderBy: { fullName: "asc" },
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
  });
});

app.patch("/api/admin/drivers/:driverId", auth, requireOperations, async (request, response) => {
  const allowed = ["fullName", "email", "vehicleModel", "vehicleYear", "plate", "phone", "capacity", "compartments", "city", "state", "notes", "rating"];
  const data = Object.fromEntries(Object.entries(request.body || {}).filter(([key]) => allowed.includes(key)));
  const driver = await prisma.driver.update({ where: { id: request.params.driverId }, data });
  broadcast("driver-updated");
  response.json({ driver: publicDriver(driver) });
});

app.delete("/api/admin/drivers/:driverId", auth, requireAdmin, async (request, response) => {
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