import { apiFetch } from "@/lib/api";

export type MapPoint = { latitude: number; longitude: number };

// Extrai latitude/longitude de "-6.1191, -47.2840" ou de links do Google Maps
// (!3d..!4d.., @lat,lng, ?q=lat,lng, ll=, query=). Retorna null se não achar
// um ponto válido dentro do Brasil.
export const parseCoordinatesInput = (raw: string): MapPoint | null => {
  let text = raw.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    // mantém o texto original se houver % solto
  }
  const number = String.raw`(-?\d{1,2}(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`!3d${number}!4d(-?\d{1,3}(?:\.\d+)?)`),
    new RegExp(
      String.raw`[?&](?:q|query|ll|destination|center)=(?:loc:)?${number}\s*,\s*\+?(-?\d{1,3}(?:\.\d+)?)`,
    ),
    new RegExp(String.raw`@${number},(-?\d{1,3}(?:\.\d+)?)`),
    new RegExp(String.raw`^${number}\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    // Limites aproximados do território brasileiro.
    if (
      latitude >= -34 &&
      latitude <= 6 &&
      longitude >= -74 &&
      longitude <= -28
    )
      return { latitude, longitude };
  }
  return null;
};

const isShortMapLink = (value: string) =>
  /^https:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(value.trim());

/**
 * Converte o que o operador colou (coordenadas, link completo ou link curto
 * do Google Maps) em um ponto. Links curtos são abertos pelo backend.
 */
export const resolveMapPoint = async (
  input: string,
): Promise<{ point: MapPoint } | { error: string }> => {
  let source = input.trim();
  if (!source)
    return { error: "Cole o link do Google Maps ou as coordenadas do local." };
  if (isShortMapLink(source)) {
    const token = localStorage.getItem("acneto-access-token");
    const response = await apiFetch("/api/operations/resolve-map-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
      },
      body: JSON.stringify({ url: source }),
    }).catch(() => null);
    const body = response
      ? ((await response.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        })
      : {};
    if (!response?.ok || !body.url)
      return {
        error:
          body.error ??
          "Não foi possível abrir o link do Google Maps. Cole as coordenadas (ex.: -6.1191, -47.2840).",
      };
    source = body.url;
  }
  const point = parseCoordinatesInput(source);
  return point
    ? { point }
    : {
        error:
          "Não encontramos o ponto nesse link. Clique no local exato no Google Maps antes de copiar o link, ou cole as coordenadas (ex.: -6.1191, -47.2840).",
      };
};

export const googleMapsSearchUrl = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
