export interface SeedCafe {
  name: string;
  area: string;
  description: string;
  tables: Array<{ label: string; capacity: number }>;
}

export const DELHI_CAFES: SeedCafe[] = [
  {
    name: 'Blue Tokai Connaught Place',
    area: 'Connaught Place',
    description: 'Third-wave coffee roastery with a busy inner-circle patio.',
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
    tables: [
      { label: 'T1', capacity: 4 },
      { label: 'T2', capacity: 4 },
      { label: 'T3', capacity: 6 },
    ],
  },
];
