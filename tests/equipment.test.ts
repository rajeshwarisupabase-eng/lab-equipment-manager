import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadIndexHelpers() {
  const htmlPath = path.resolve(process.cwd(), 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Expected inline <script> in index.html');

  const context: Record<string, unknown> = {};
  vm.runInNewContext(scriptMatch[1], context);
  return context as {
    normalizeSupabaseUrl: (url: string) => string;
    isSupabaseConfigured: (url: string, key: string) => boolean;
    formatSupabaseError: (err: { code?: string; message?: string } | null, fallback?: string) => string;
    computeStats: (items: Array<Record<string, unknown>>) => {
      total: number;
      available: number;
      issued: number;
      categories: number;
      totalUnits: number;
    };
    filterEquipment: (
      items: Array<Record<string, unknown>>,
      searchTerm: string,
      statusFilter: string
    ) => Array<Record<string, unknown>>;
    validateNewEquipment: (
      name: string,
      category: string,
      quantityRaw: string | number
    ) => { valid: boolean; error?: string; data?: { name: string; category: string; quantity: number } };
    validateIssueInput: (
      issuedTo: string,
      issueDate: string
    ) => { valid: boolean; error?: string; data?: { issued_to: string; issue_date: string } };
    escapeHtml: (value: unknown) => string;
    escapeCsvCell: (value: unknown) => string;
    equipmentToCsv: (items: Array<Record<string, unknown>>) => string;
  };
}

const helpers = loadIndexHelpers();

test('isSupabaseConfigured detects placeholders vs real project URLs', () => {
  assert.equal(helpers.isSupabaseConfigured('YOUR_SUPABASE_URL', 'YOUR_SUPABASE_ANON_KEY'), false);
  assert.equal(helpers.isSupabaseConfigured('', 'abc'), false);
  assert.equal(helpers.isSupabaseConfigured('not-a-url', 'abc'), false);
  assert.equal(
    helpers.isSupabaseConfigured('https://xyzcompany.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
    true
  );
});

test('computeStats calculates totals, statuses, units, and case-insensitive unique categories', () => {
  const sample = [
    { id: 1, name: 'Oscilloscope', category: 'Electronics', quantity: 4, status: 'available' },
    { id: 2, name: 'Multimeter', category: 'electronics', quantity: 5, status: 'issued' },
    { id: 3, name: 'Microscope', category: 'Biology', quantity: 2, status: 'available' }
  ];

  const stats = JSON.parse(JSON.stringify(helpers.computeStats(sample)));
  assert.deepEqual(stats, {
    total: 3,
    available: 2,
    issued: 1,
    categories: 2,
    totalUnits: 11
  });
});

test('filterEquipment filters by name/category and status dropdown', () => {
  const sample = [
    { id: 1, name: 'Digital Oscilloscope', category: 'Electronics', status: 'available' },
    { id: 2, name: 'Compound Microscope', category: 'Biology', status: 'issued' },
    { id: 3, name: 'Analytical Balance', category: 'Chemistry', status: 'available' }
  ];

  assert.equal(helpers.filterEquipment(sample, '', 'all').length, 3);
  assert.equal(helpers.filterEquipment(sample, '', 'available').length, 2);
  assert.equal(helpers.filterEquipment(sample, '', 'issued').length, 1);
  assert.equal(helpers.filterEquipment(sample, 'micro', 'all').length, 1);
  assert.equal(helpers.filterEquipment(sample, 'chem', 'available').length, 1);
  assert.equal(helpers.filterEquipment(sample, 'chem', 'issued').length, 0);
});

test('validateNewEquipment rejects invalid input and normalizes valid entries', () => {
  assert.equal(helpers.validateNewEquipment('', 'Optics', 1).valid, false);
  assert.equal(helpers.validateNewEquipment('Laser', '   ', 1).valid, false);
  assert.equal(helpers.validateNewEquipment('Laser', 'Optics', 0).valid, false);
  assert.equal(helpers.validateNewEquipment('Laser', 'Optics', 1.5).valid, false);

  const ok = JSON.parse(JSON.stringify(helpers.validateNewEquipment('  HeNe Laser ', ' Optics ', '3')));
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.data, {
    name: 'HeNe Laser',
    category: 'Optics',
    quantity: 3
  });
});

test('validateIssueInput enforces borrower name and ISO date', () => {
  assert.equal(helpers.validateIssueInput('', '2026-11-16').valid, false);
  assert.equal(helpers.validateIssueInput('Dr. Rao', '').valid, false);
  assert.equal(helpers.validateIssueInput('Dr. Rao', '16/11/2026').valid, false);

  const ok = JSON.parse(JSON.stringify(helpers.validateIssueInput(' Dr. Rao ', '2026-11-16')));
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.data, {
    issued_to: 'Dr. Rao',
    issue_date: '2026-11-16'
  });
});

test('escapeHtml escapes HTML special characters to prevent XSS', () => {
  assert.equal(
    helpers.escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
});

test('escapeCsvCell and equipmentToCsv format headers, quoted commas/quotes, and issued metadata', () => {
  assert.equal(helpers.escapeCsvCell('Oscilloscope, 100MHz'), '"Oscilloscope, 100MHz"');
  assert.equal(helpers.escapeCsvCell('24" Monitor'), '"24"" Monitor"');
  assert.equal(helpers.escapeCsvCell(null), '');

  const csv = helpers.equipmentToCsv([
    {
      id: 1,
      name: 'Oscilloscope, 100 MHz',
      category: 'Electronics',
      quantity: 4,
      status: 'available',
      issued_to: 'ignored-when-available',
      issue_date: '2026-11-10'
    },
    {
      id: 2,
      name: 'Microscope "Pro"',
      category: 'Biology',
      quantity: 2,
      status: 'issued',
      issued_to: 'Dr. Priya Sharma',
      issue_date: '2026-11-16'
    }
  ]);

  assert.equal(
    csv,
    [
      'ID,Equipment Name,Category,Quantity,Status,Issued To,Issue Date',
      '1,"Oscilloscope, 100 MHz",Electronics,4,available,,',
      '2,"Microscope ""Pro""",Biology,2,issued,Dr. Priya Sharma,2026-11-16'
    ].join('\r\n')
  );
});

test('normalizeSupabaseUrl strips /rest/v1/ suffix and trailing slashes', () => {
  assert.equal(
    helpers.normalizeSupabaseUrl('https://outpenykahnppfycidoh.supabase.co/rest/v1/'),
    'https://outpenykahnppfycidoh.supabase.co'
  );
  assert.equal(
    helpers.normalizeSupabaseUrl('https://outpenykahnppfycidoh.supabase.co/'),
    'https://outpenykahnppfycidoh.supabase.co'
  );
});

test('formatSupabaseError gives clear guidance when table, grants, or RLS policy is missing', () => {
  assert.match(
    helpers.formatSupabaseError({ code: 'PGRST205', message: "Could not find the table 'public.equipment'" }),
    /equipment.*SQL Editor/i
  );
  assert.match(
    helpers.formatSupabaseError({ code: '42501', message: 'permission denied for table equipment' }),
    /table permissions are missing.*SQL Editor/i
  );
  assert.match(
    helpers.formatSupabaseError({ code: '42501', message: 'new row violates row-level security policy' }),
    /Row Level Security/i
  );
});
