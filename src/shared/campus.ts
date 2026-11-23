export const CATEGORIES = [
  'Water',
  'Electricity',
  'Cleanliness',
  'Internet',
  'Maintenance',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const STATUSES = [
  'Reported',
  'Acknowledged',
  'In Progress',
  'Resolved',
] as const;

export type ComplaintStatus = (typeof STATUSES)[number];

export const DEPARTMENTS = [
  'Computer Science & Engineering',
  'Electronics & Communications',
  'Mechanical Engineering',
  'Electrical Engineering',
  'Civil Engineering',
  'PUC (Pre-University Course)',
] as const;

export const LOCATIONS = [
  'Academic Block 1 (AB-1)',
  'Academic Block 2 (AB-2)',
  'Boys Hostel Complex',
  'Girls Hostel Complex',
  'Mess & Campus Canteen',
  'Central Library & Admin Block',
] as const;

export type CampusLocationName = (typeof LOCATIONS)[number];

export interface CampusLocationConfig {
  name: CampusLocationName;
  code: string;
  description: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

export const DEFAULT_LOCATIONS: CampusLocationConfig[] = [
  {
    name: 'Academic Block 1 (AB-1)',
    code: 'AB-1',
    description: 'PUC & Engineering lecture halls and CSE/ECE rooms',
    lat: 18.8826,
    lng: 77.9212,
    radiusMeters: 95,
  },
  {
    name: 'Academic Block 2 (AB-2)',
    code: 'AB-2',
    description: 'Engineering labs and Mechanical/Civil workshops',
    lat: 18.8814,
    lng: 77.9216,
    radiusMeters: 90,
  },
  {
    name: 'Boys Hostel Complex',
    code: 'BH-COMPLEX',
    description: 'BH-1 & BH-2 residential wings and water coolers',
    lat: 18.8834,
    lng: 77.9195,
    radiusMeters: 115,
  },
  {
    name: 'Girls Hostel Complex',
    code: 'GH-COMPLEX',
    description: 'GH-1 & GH-2 residential hostels and study halls',
    lat: 18.8805,
    lng: 77.9197,
    radiusMeters: 110,
  },
  {
    name: 'Mess & Campus Canteen',
    code: 'MESS-CANT',
    description: 'Dining mess halls and campus student canteen',
    lat: 18.8821,
    lng: 77.9187,
    radiusMeters: 85,
  },
  {
    name: 'Central Library & Admin Block',
    code: 'LIB-ADM',
    description: 'Central Library and Administrative Building',
    lat: 18.8819,
    lng: 77.9229,
    radiusMeters: 95,
  },
];

const LOCATION_ALIASES: Record<string, CampusLocationName> = {
  'ab-1': 'Academic Block 1 (AB-1)',
  'ab1': 'Academic Block 1 (AB-1)',
  'academic block 1': 'Academic Block 1 (AB-1)',
  'academic block 1 (ab-1)': 'Academic Block 1 (AB-1)',
  'ab-2': 'Academic Block 2 (AB-2)',
  'ab2': 'Academic Block 2 (AB-2)',
  'academic block 2': 'Academic Block 2 (AB-2)',
  'academic block 2 (ab-2)': 'Academic Block 2 (AB-2)',
  'bh-complex': 'Boys Hostel Complex',
  'boys hostel': 'Boys Hostel Complex',
  'boys hostel complex': 'Boys Hostel Complex',
  'gh-complex': 'Girls Hostel Complex',
  'girls hostel': 'Girls Hostel Complex',
  'girls hostel complex': 'Girls Hostel Complex',
  'mess': 'Mess & Campus Canteen',
  'canteen': 'Mess & Campus Canteen',
  'mess & canteen': 'Mess & Campus Canteen',
  'mess & campus canteen': 'Mess & Campus Canteen',
  'library': 'Central Library & Admin Block',
  'admin block': 'Central Library & Admin Block',
  'central library & admin block': 'Central Library & Admin Block',
};

export function normalizeCampusLocation(raw: unknown): CampusLocationName | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if ((LOCATIONS as readonly string[]).includes(trimmed)) {
    return trimmed as CampusLocationName;
  }
  return LOCATION_ALIASES[trimmed.toLowerCase()] ?? null;
}

export interface AuthUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: 'student' | 'admin';
  rollNumber: string | null;
  mobileNumber: string | null;
  department: string | null;
  needsProfileCompletion?: boolean;
}

export interface ComplaintRecord {
  id: number;
  complaintCode: string;
  title: string;
  description: string;
  category: Category;
  location: CampusLocationName;
  buildingBlock: string;
  floorRoom: string;
  status: ComplaintStatus;
  studentUserId: number | null;
  studentName: string;
  rollNumber: string;
  studentMobile: string;
  imageId: string | null;
  imageUrl: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsResponse {
  total: number;
  pendingCount: number;
  inProgressCount: number;
  resolvedCount: number;
  resolutionRate: number;
  topCategory: { category: string; count: number } | null;
  topLocation: { location: string; count: number } | null;
  byCategory: { category: Category; count: number }[];
  byStatus: {
    Reported: number;
    Acknowledged: number;
    'In Progress': number;
    Resolved: number;
  };
  byLocation: {
    location: CampusLocationName;
    total: number;
    reported: number;
    acknowledged: number;
    inProgress: number;
    resolved: number;
  }[];
}
