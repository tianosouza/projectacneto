import { PrismaClient } from "@prisma/client";
import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

async function main() {
  const email = (process.env.DRIVER_EMAIL || "motorista.validacao@acnetotransportes.com")
    .trim()
    .toLowerCase();
  const fullName = (process.env.DRIVER_NAME || "Motorista de Validacao").trim();
  const password = process.env.DRIVER_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error("DRIVER_PASSWORD must contain at least 12 characters");
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName, passwordHash },
    create: { email, fullName, passwordHash },
  });

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: { fullName, role: "driver", approved: true },
    create: { userId: user.id, fullName, role: "driver", approved: true },
  });

  await prisma.driver.upsert({
    where: { userId: user.id },
    update: {
      fullName,
      email,
      vehicleModel: "Carreta tanque",
      vehicleYear: 2024,
      capacity: "30.000 L",
      compartments: "5 compartimentos",
      plate: "ACN-2026",
      city: null,
      state: null,
      isOnline: false,
      status: "offline",
      notes: null,
    },
    create: {
      userId: user.id,
      fullName,
      email,
      vehicleModel: "Carreta tanque",
      vehicleYear: 2024,
      capacity: "30.000 L",
      compartments: "5 compartimentos",
      plate: "ACN-2026",
      city: null,
      state: null,
      isOnline: false,
      status: "offline",
    },
  });

  console.log(`Motorista disponível para acesso: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
