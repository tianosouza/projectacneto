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

const operationalTestLocations = [
  ["collection_point", "Posto teste Campinas", "Campinas", "SP", -22.9056, -47.0608],
  ["final_customer", "Cliente teste Campinas", "Campinas", "SP", -22.9380, -47.1200],
  ["collection_point", "Posto teste Ribeirao Preto", "Ribeirao Preto", "SP", -21.1704, -47.8103],
  ["final_customer", "Cliente teste Ribeirao Preto", "Ribeirao Preto", "SP", -21.2200, -47.7600],
  ["collection_point", "Posto teste Sao Paulo", "Sao Paulo", "SP", -23.5505, -46.6333],
  ["final_customer", "Cliente teste Sao Paulo", "Sao Paulo", "SP", -23.6100, -46.6900],
  ["collection_point", "Posto teste Santos", "Santos", "SP", -23.9608, -46.3336],
  ["final_customer", "Cliente teste Santos", "Santos", "SP", -23.9950, -46.3000],
  ["collection_point", "Posto teste Belo Horizonte", "Belo Horizonte", "MG", -19.9167, -43.9345],
  ["final_customer", "Cliente teste Belo Horizonte", "Belo Horizonte", "MG", -19.8800, -43.9800],
  ["collection_point", "Posto teste Uberlandia", "Uberlandia", "MG", -18.9186, -48.2772],
  ["final_customer", "Cliente teste Uberlandia", "Uberlandia", "MG", -18.9500, -48.2200],
  ["collection_point", "Posto teste Goiania", "Goiania", "GO", -16.6869, -49.2648],
  ["final_customer", "Cliente teste Goiania", "Goiania", "GO", -16.7300, -49.3000],
  ["collection_point", "Posto teste Curitiba", "Curitiba", "PR", -25.4284, -49.2733],
  ["final_customer", "Cliente teste Curitiba", "Curitiba", "PR", -25.4700, -49.2200],
  ["collection_point", "Posto teste Rio de Janeiro", "Rio de Janeiro", "RJ", -22.9068, -43.1729],
  ["final_customer", "Cliente teste Rio de Janeiro", "Rio de Janeiro", "RJ", -22.9500, -43.2200],
  ["collection_point", "Posto teste Brasilia", "Brasilia", "DF", -15.7975, -47.8919],
  ["final_customer", "Cliente teste Brasilia", "Brasilia", "DF", -15.8400, -47.9000],
];

async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@acnetotransportes.com").trim().toLowerCase();
  const fullName = (process.env.ADMIN_NAME || "Administrador").trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
  }

  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          "admin.demo@acneto.com",
          "operator.demo@acneto.com",
          "driver.demo@acneto.com",
        ],
      },
    },
  });

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

  for (const [kind, name, city, state, latitude, longitude] of operationalTestLocations) {
    await prisma.operationalLocation.upsert({
      where: { id: `seed-${kind}-${city.toLowerCase().replaceAll(" ", "-")}` },
      update: { name, city, state, latitude, longitude, active: true },
      create: {
        id: `seed-${kind}-${city.toLowerCase().replaceAll(" ", "-")}`,
        kind,
        name,
        email: `${kind === "collection_point" ? "posto" : "cliente"}.${city.toLowerCase().replaceAll(" ", "-")}@demo.acneto.com`,
        phone: "85999990000",
        address: `Endereco de teste, 100 - ${city}`,
        city,
        state,
        latitude,
        longitude,
        active: true,
      },
    });
  }

  console.log(`Pontos operacionais de teste disponíveis: ${operationalTestLocations.length}`);

  console.log(`Administrador disponível para acesso: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());