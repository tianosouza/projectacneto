import type { LatLngTuple } from "leaflet";

export type AccessLevel = "cliente" | "operador" | "admin";

export type DemoContact = {
  id: string;
  name: string;
  email: string;
  region: string;
  accessLevel: AccessLevel;
  status: "ativo" | "pendente";
  latitude: number | null;
  longitude: number | null;
};

export type PendingUser = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  requested_role: "driver" | "operator";
  registration_notes: string | null;
  approval_closed?: boolean;
  created_at: string;
};

export type ApprovalDriverFields = {
  full_name: string;
  phone: string;
  vehicle_model: string;
  plate: string;
  city: string;
  state: string;
  capacity: string;
  compartments: string;
};

export type DemoDriver = {
  id: string;
  full_name: string;
  email: string | null;
  city: string;
  state: string;
  vehicle_model: string;
  plate: string;
  phone: string | null;
  capacity: string;
  compartments: string;
  notes: string;
  availability_since: string;
  is_online: boolean;
  rating: number;
  status:
    | "available"
    | "awaiting_loading"
    | "awaiting_documents"
    | "in_transit"
    | "awaiting_unloading"
    | "offline"
    | "in_negotiation";
  latitude: number | null;
  longitude: number | null;
  last_seen?: string;
};

export type DirectoryOperator = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string;
};

export type RouteSummary = {
  distance: number;
  duration: number;
};

export type RouteState = {
  path: LatLngTuple[];
  summary: RouteSummary | null;
  loading: boolean;
  error: string;
};
