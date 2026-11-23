import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { campusLocations, complaints } from './schema.ts';
import { DEFAULT_LOCATIONS } from '../shared/campus.ts';

export interface DemoComplaintSeed {
  title: string;
  description: string;
  category: string;
  location: string;
  buildingBlock: string;
  floorRoom: string;
  status: string;
  studentName: string;
  rollNumber: string;
  studentMobile: string;
  createdAt: Date;
}

export const DEMO_COMPLAINT_SEEDS: DemoComplaintSeed[] = [
  {
    title: 'DEMO: Drinking water RO cooler pipeline leak on 2nd floor',
    description: 'Water seepage behind RO cooler near east staircase.',
    category: 'Water',
    location: 'Boys Hostel Complex',
    buildingBlock: 'BH-1 East Wing',
    floorRoom: '2nd Floor · Corridor B',
    status: 'Reported',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-18T08:15:00Z'),
  },
  {
    title: 'DEMO: Overhead tank float valve overflow in BH-2',
    description: 'Terrace tank overflows every morning around 6:30 AM.',
    category: 'Water',
    location: 'Boys Hostel Complex',
    buildingBlock: 'BH-2 Block',
    floorRoom: 'Terrace / 3rd Floor',
    status: 'Acknowledged',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-17T14:40:00Z'),
  },
  {
    title: 'DEMO: Corridor tube lights flickering in BH-1 Ground Floor',
    description: 'Three LED battens near study room entrance flicker at night.',
    category: 'Electricity',
    location: 'Boys Hostel Complex',
    buildingBlock: 'BH-1 Main Wing',
    floorRoom: 'Ground Floor · Room G-14',
    status: 'In Progress',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-19T19:20:00Z'),
  },
  {
    title: 'DEMO: Broken window latch in BH-2 reading hall',
    description: 'Latch bracket snapped off causing metal frame to bang.',
    category: 'Maintenance',
    location: 'Boys Hostel Complex',
    buildingBlock: 'BH-2 Study Hall',
    floorRoom: '1st Floor · Hall 102',
    status: 'Resolved',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-12T10:05:00Z'),
  },
  {
    title: 'DEMO: Campus LAN & Wi-Fi packet loss in CSE Lab-2',
    description: 'Switch port rack B loses uplink every 20 minutes during lab.',
    category: 'Internet',
    location: 'Academic Block 1 (AB-1)',
    buildingBlock: 'AB-1 CSE Wing',
    floorRoom: '2nd Floor · Lab 204',
    status: 'Reported',
    studentName: 'Sravani Reddy',
    rollNumber: 'B191402',
    studentMobile: '9876543210',
    createdAt: new Date('2026-11-19T11:10:00Z'),
  },
  {
    title: 'DEMO: Classroom projector HDMI wall socket loose',
    description: 'Display disconnects when podium cable is moved.',
    category: 'Maintenance',
    location: 'Academic Block 1 (AB-1)',
    buildingBlock: 'AB-1 North Block',
    floorRoom: '1st Floor · Classroom 108',
    status: 'In Progress',
    studentName: 'Sravani Reddy',
    rollNumber: 'B191402',
    studentMobile: '9876543210',
    createdAt: new Date('2026-11-16T09:50:00Z'),
  },
  {
    title: 'DEMO: UPS backup tripping in AB-1 Ground Floor',
    description: 'Row C power sockets trip during generator changeover.',
    category: 'Electricity',
    location: 'Academic Block 1 (AB-1)',
    buildingBlock: 'AB-1 South Wing',
    floorRoom: 'Ground Floor · Room 005',
    status: 'Resolved',
    studentName: 'Sravani Reddy',
    rollNumber: 'B191402',
    studentMobile: '9876543210',
    createdAt: new Date('2026-11-10T16:00:00Z'),
  },
  {
    title: 'DEMO: Solar hot water pipeline pressure low in GH-1',
    description: 'Morning hot water does not reach 3rd-floor washrooms.',
    category: 'Water',
    location: 'Girls Hostel Complex',
    buildingBlock: 'GH-1 West Wing',
    floorRoom: '3rd Floor · Washroom Block',
    status: 'Acknowledged',
    studentName: 'Sravani Reddy',
    rollNumber: 'B191402',
    studentMobile: '9876543210',
    createdAt: new Date('2026-11-19T06:45:00Z'),
  },
  {
    title: 'DEMO: Hostel corridor Wi-Fi access point offline',
    description: 'AP-GH2-03 offline; rooms 210-224 cannot reach intranet.',
    category: 'Internet',
    location: 'Girls Hostel Complex',
    buildingBlock: 'GH-2 Block',
    floorRoom: '2nd Floor · Rooms 210-224',
    status: 'Reported',
    studentName: 'Sravani Reddy',
    rollNumber: 'B191402',
    studentMobile: '9876543210',
    createdAt: new Date('2026-11-20T08:10:00Z'),
  },
  {
    title: 'DEMO: Overflowing waste bins behind Mess Hall 1 exit',
    description: 'Food waste bins near dishwashing exit need immediate clearing.',
    category: 'Cleanliness',
    location: 'Mess & Campus Canteen',
    buildingBlock: 'Mess Hall 1',
    floorRoom: 'Ground Floor · Rear Exit',
    status: 'Reported',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-20T07:45:00Z'),
  },
  {
    title: 'DEMO: Clogged handwash sink drain near Canteen counter',
    description: 'Drainage pipe backs up during lunch rush hours.',
    category: 'Water',
    location: 'Mess & Campus Canteen',
    buildingBlock: 'Student Canteen',
    floorRoom: 'Ground Floor · Wash Area',
    status: 'In Progress',
    studentName: 'Sravani Reddy',
    rollNumber: 'B191402',
    studentMobile: '9876543210',
    createdAt: new Date('2026-11-18T13:20:00Z'),
  },
  {
    title: 'DEMO: Dining hall exhaust fan rattling loudly',
    description: 'South wall exhaust fan vibrates heavily.',
    category: 'Cleanliness',
    location: 'Mess & Campus Canteen',
    buildingBlock: 'Mess Hall 2',
    floorRoom: 'Ground Floor · Dining Bay',
    status: 'Acknowledged',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-19T12:35:00Z'),
  },
  {
    title: 'DEMO: Three-phase sub-panel breaker tripping in Mechanical Workshop',
    description: 'Lathe bay MCB trips when multiple machines start.',
    category: 'Electricity',
    location: 'Academic Block 2 (AB-2)',
    buildingBlock: 'AB-2 Mechanical Workshop',
    floorRoom: 'Ground Floor · Lathe Bay',
    status: 'In Progress',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-17T10:25:00Z'),
  },
  {
    title: 'DEMO: Loose floor drainage grating near CNC Lab',
    description: 'Metal coolant trench cover shifts when stepped on.',
    category: 'Maintenance',
    location: 'Academic Block 2 (AB-2)',
    buildingBlock: 'AB-2 CNC & Metallurgy',
    floorRoom: 'Ground Floor · Bay 2',
    status: 'Reported',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-18T15:10:00Z'),
  },
  {
    title: 'DEMO: Weak eduroam signal in Central Library 2nd-floor reading room',
    description: 'Digital journal terminals lose Wi-Fi near west window.',
    category: 'Internet',
    location: 'Central Library & Admin Block',
    buildingBlock: 'Central Library',
    floorRoom: '2nd Floor · Reading Hall',
    status: 'Reported',
    studentName: 'Sravani Reddy',
    rollNumber: 'B191402',
    studentMobile: '9876543210',
    createdAt: new Date('2026-11-19T09:15:00Z'),
  },
  {
    title: 'DEMO: Courtyard storm drain choked with dry leaves',
    description: 'Rainwater accumulates near Admin Block entrance steps.',
    category: 'Cleanliness',
    location: 'Central Library & Admin Block',
    buildingBlock: 'Administrative Plaza',
    floorRoom: 'Ground Floor · Main Portico',
    status: 'Resolved',
    studentName: 'Karthik Goud',
    rollNumber: 'B192118',
    studentMobile: '9849012345',
    createdAt: new Date('2026-11-14T08:00:00Z'),
  },
];

let seededLocationsPromise: Promise<void> | null = null;

export async function ensureCampusLocationsSeeded(): Promise<void> {
  if (seededLocationsPromise) {
    return seededLocationsPromise;
  }
  seededLocationsPromise = (async () => {
    try {
      for (const loc of DEFAULT_LOCATIONS) {
        await db
          .insert(campusLocations)
          .values({
            name: loc.name,
            code: loc.code,
            description: loc.description,
            lat: loc.lat,
            lng: loc.lng,
            radiusMeters: loc.radiusMeters,
          })
          .onConflictDoNothing({ target: campusLocations.name });
      }
    } catch (error) {
      seededLocationsPromise = null;
      console.error('Failed to seed campus locations:', error);
      throw new Error('Failed to initialize campus locations.', { cause: error });
    }
  })();
  return seededLocationsPromise;
}

export async function resetDemoComplaintsOnly(): Promise<number> {
  try {
    return await db.transaction(async (tx) => {
      // Strictly delete ONLY demo records; never touch real student complaints (isDemo = false)
      await tx.delete(complaints).where(eq(complaints.isDemo, true));

      let insertedCount = 0;
      for (const seed of DEMO_COMPLAINT_SEEDS) {
        const tempCode = `PENDING-DEMO-${crypto.randomUUID()}`;
        const [inserted] = await tx
          .insert(complaints)
          .values({
            complaintCode: tempCode,
            title: seed.title,
            description: seed.description,
            category: seed.category,
            location: seed.location,
            buildingBlock: seed.buildingBlock,
            floorRoom: seed.floorRoom,
            status: seed.status,
            studentUserId: null,
            studentName: seed.studentName,
            rollNumber: seed.rollNumber,
            studentMobile: seed.studentMobile,
            imageId: null,
            isDemo: true,
            createdAt: seed.createdAt,
            updatedAt: seed.createdAt,
          })
          .returning({ id: complaints.id });

        await tx
          .update(complaints)
          .set({ complaintCode: `DEMO-${1000 + inserted.id}` })
          .where(eq(complaints.id, inserted.id));

        insertedCount++;
      }
      return insertedCount;
    });
  } catch (error) {
    console.error('Failed to reset demo complaints:', error);
    throw new Error('Failed to reset demo complaints.', { cause: error });
  }
}
