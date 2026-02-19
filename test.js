// 30분 구간 그룹핑 단위 테스트

function groupBySegment(transcript, segmentSeconds) {
  const segments = [];
  let current = { startSec: 0, endSec: segmentSeconds, items: [] };

  for (const item of transcript) {
    while (item.start >= current.endSec) {
      if (current.items.length > 0) segments.push(current);
      const nextStart = current.endSec;
      current = { startSec: nextStart, endSec: nextStart + segmentSeconds, items: [] };
    }
    current.items.push(item);
  }
  if (current.items.length > 0) segments.push(current);
  return segments;
}

function formatTimeRange(startSec, endSec) {
  const fmt = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
    return `${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
  };
  return `${fmt(startSec)}~${fmt(endSec)}`;
}

// 테스트 실행
let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

function assertEqual(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// Test 1: 빈 트랜스크립트
assertEqual('빈 트랜스크립트', groupBySegment([], 1800), []);

// Test 2: 30분 이하 영상 → 1개 세그먼트
const short = [
  { start: 0, text: 'hello' },
  { start: 60, text: 'world' },
  { start: 600, text: 'test' },
];
const shortResult = groupBySegment(short, 1800);
assertEqual('30분 이하 세그먼트 수', shortResult.length, 1);
assertEqual('30분 이하 아이템 수', shortResult[0].items.length, 3);

// Test 3: 60분 영상 → 2개 세그먼트
const long = [
  { start: 0, text: 'a' },
  { start: 900, text: 'b' },    // 15분
  { start: 1799, text: 'c' },   // 29:59
  { start: 1800, text: 'd' },   // 30:00 → 두 번째 구간
  { start: 2700, text: 'e' },   // 45분
  { start: 3500, text: 'f' },   // 58:20
];
const longResult = groupBySegment(long, 1800);
assertEqual('60분 세그먼트 수', longResult.length, 2);
assertEqual('첫 구간 아이템', longResult[0].items.length, 3);
assertEqual('둘째 구간 아이템', longResult[1].items.length, 3);
assertEqual('첫 구간 범위', [longResult[0].startSec, longResult[0].endSec], [0, 1800]);
assertEqual('둘째 구간 범위', [longResult[1].startSec, longResult[1].endSec], [1800, 3600]);

// Test 4: 빈 중간 구간 건너뛰기 (0~30분에 데이터, 30~60분 비어있고, 60~90분에 데이터)
const gapped = [
  { start: 0, text: 'a' },
  { start: 3600, text: 'b' },  // 60분
];
const gappedResult = groupBySegment(gapped, 1800);
assertEqual('빈 구간 건너뛰기 세그먼트 수', gappedResult.length, 2);
assertEqual('빈 구간 건너뛰기 첫 구간', gappedResult[0].startSec, 0);
assertEqual('빈 구간 건너뛰기 둘째 구간', gappedResult[1].startSec, 3600);

// Test 5: formatTimeRange
assertEqual('짧은 시간 범위', formatTimeRange(0, 1800), '00:00~30:00');
assertEqual('긴 시간 범위', formatTimeRange(3600, 5400), '01:00:00~01:30:00');

// Test 6: 10분 단위 그룹핑
const tenMin = [
  { start: 0, text: 'a' },
  { start: 300, text: 'b' },    // 5분
  { start: 599, text: 'c' },    // 9:59
  { start: 600, text: 'd' },    // 10:00 → 두 번째 구간
  { start: 900, text: 'e' },    // 15분
];
const tenMinResult = groupBySegment(tenMin, 600); // 10분 = 600초
assertEqual('10분 단위 세그먼트 수', tenMinResult.length, 2);
assertEqual('10분 단위 첫 구간 아이템', tenMinResult[0].items.length, 3);
assertEqual('10분 단위 둘째 구간 아이템', tenMinResult[1].items.length, 2);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
