import type { DemoContact, DemoDriver } from "./dashboardTypes";

export const loadList = <T>(key: string, fallback: T[]): T[] => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T[];
  } catch {
    return fallback;
  }
};

export const saveList = <T>(key: string, value: T[]) => {
  if (typeof window !== "undefined")
    localStorage.setItem(key, JSON.stringify(value));
};

const developmentClientData: Array<[string, string, string, number, number]> = [
  [
    "Cliente Demo Ribeirão",
    "cliente.ribeirao@demo.local",
    "Ribeirão Preto",
    -21.1775,
    -47.8103,
  ],
  [
    "Cliente Demo Campinas",
    "cliente.campinas@demo.local",
    "Campinas",
    -22.9099,
    -47.0626,
  ],
  [
    "Cliente Demo São Paulo",
    "cliente.saopaulo@demo.local",
    "São Paulo",
    -23.5505,
    -46.6333,
  ],
  [
    "Cliente Demo Santos",
    "cliente.santos@demo.local",
    "Santos",
    -23.9608,
    -46.3336,
  ],
  [
    "Cliente Demo Belo Horizonte",
    "cliente.bh@demo.local",
    "Belo Horizonte",
    -19.9167,
    -43.9345,
  ],
  [
    "Cliente Demo Uberlândia",
    "cliente.uberlandia@demo.local",
    "Uberlândia",
    -18.9186,
    -48.2772,
  ],
  [
    "Cliente Demo Goiânia",
    "cliente.goiania@demo.local",
    "Goiânia",
    -16.6869,
    -49.2648,
  ],
  [
    "Cliente Demo Curitiba",
    "cliente.curitiba@demo.local",
    "Curitiba",
    -25.4284,
    -49.2733,
  ],
  [
    "Cliente Demo Rio de Janeiro",
    "cliente.rio@demo.local",
    "Rio de Janeiro",
    -22.9068,
    -43.1729,
  ],
  [
    "Cliente Demo Brasília",
    "cliente.brasilia@demo.local",
    "Brasília",
    -15.7975,
    -47.8919,
  ],
];

const developmentClients: DemoContact[] = developmentClientData.map(
  ([name, email, region, latitude, longitude], index) => ({
    id: `client-demo-${index + 1}`,
    name,
    email,
    region,
    accessLevel: "cliente",
    status: "ativo",
    latitude,
    longitude,
  }),
);

export const getDevelopmentClients = (): DemoContact[] => {
  if (typeof window === "undefined") return developmentClients;
  const saved = localStorage.getItem("acneto-clients");
  if (!saved) return developmentClients;
  try {
    const parsed = JSON.parse(saved) as DemoContact[];
    const productionClients = parsed.filter(
      (client) => !client.id.startsWith("client-demo-"),
    );
    if (!import.meta.env.DEV) return productionClients;

    const existingIds = new Set(parsed.map((client) => client.id));
    return [
      ...parsed,
      ...developmentClients.filter((client) => !existingIds.has(client.id)),
    ];
  } catch {
    return developmentClients;
  }
};

export const getOnlineDrivers = (): DemoDriver[] => {
  if (typeof window === "undefined") return [];
  const saved = localStorage.getItem("acneto-drivers");
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved) as DemoDriver[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const isDriverCurrentlyOnline = (driver: DemoDriver): boolean => {
  if (!driver.is_online || !driver.last_seen) return false;
  const lastSeen = new Date(driver.last_seen).getTime();
  return Number.isFinite(lastSeen) && Date.now() - lastSeen <= 2 * 60 * 1000;
};
