export interface SeedCafe {
  name: string;
  area: string;
  description: string;
  latitude: number;
  longitude: number;
  openingHour: number;
  closingHour: number;
  cuisines: string[];
  rating: number;
  ratingCount: number;
  tables: Array<{ label: string; capacity: number }>;
}

// Real Delhi coordinates per locality; ratings are seeded plausible values
// (issue #18 / PRD area D). All cafés are region 'delhi' (the entity default).
export const DELHI_CAFES: SeedCafe[] = [
  {
    name: 'Blue Tokai Connaught Place',
    area: 'Connaught Place',
    description: 'Third-wave coffee roastery with a busy inner-circle patio.',
    latitude: 28.6304,
    longitude: 77.2177,
    openingHour: 8,
    closingHour: 23,
    cuisines: ['Continental', 'Coffee'],
    rating: 4.6,
    ratingCount: 1287,
    tables: [
      { label: 'T1', capacity: 2 },
      { label: 'T2', capacity: 2 },
      { label: 'T3', capacity: 4 },
      { label: 'T4', capacity: 4 },
      { label: 'T5', capacity: 6 },
    ],
  },
  {
    name: 'Hauz Khas Social',
    area: 'Hauz Khas Village',
    description: 'All-day café overlooking the Hauz Khas lake and deer park.',
    latitude: 28.5535,
    longitude: 77.1943,
    openingHour: 11,
    closingHour: 24,
    cuisines: ['Continental', 'Asian', 'Italian'],
    rating: 4.3,
    ratingCount: 3421,
    tables: [
      { label: 'T1', capacity: 2 },
      { label: 'T2', capacity: 4 },
      { label: 'T3', capacity: 4 },
      { label: 'T4', capacity: 8 },
    ],
  },
  {
    name: 'Khan Market Book Café',
    area: 'Khan Market',
    description: 'Quiet reading-room café tucked above a Khan Market bookstore.',
    latitude: 28.5983,
    longitude: 77.2270,
    openingHour: 9,
    closingHour: 21,
    cuisines: ['Coffee', 'Continental'],
    rating: 4.8,
    ratingCount: 542,
    tables: [
      { label: 'T1', capacity: 2 },
      { label: 'T2', capacity: 2 },
      { label: 'T3', capacity: 4 },
    ],
  },
  {
    name: 'Saket Sunlight Café',
    area: 'Saket',
    description: 'Bright glass-front café near Select Citywalk with a plant wall.',
    latitude: 28.5245,
    longitude: 77.2066,
    openingHour: 10,
    closingHour: 22,
    cuisines: ['Italian', 'Continental'],
    rating: 4.1,
    ratingCount: 908,
    tables: [
      { label: 'T1', capacity: 2 },
      { label: 'T2', capacity: 4 },
      { label: 'T3', capacity: 4 },
      { label: 'T4', capacity: 6 },
    ],
  },
  {
    name: 'Vasant Kunj Garden Brew',
    area: 'Vasant Kunj',
    description: 'Courtyard café with outdoor seating under neem trees.',
    latitude: 28.5205,
    longitude: 77.1590,
    openingHour: 8,
    closingHour: 22,
    cuisines: ['Asian', 'Coffee'],
    rating: 3.9,
    ratingCount: 671,
    tables: [
      { label: 'T1', capacity: 4 },
      { label: 'T2', capacity: 4 },
      { label: 'T3', capacity: 6 },
    ],
  },
];
