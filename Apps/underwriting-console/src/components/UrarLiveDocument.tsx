/** Live URAR 1004 facsimile. Field blocks sit on the same % boxes the QA panel inspects. */

export default function UrarLiveDocument({ currentPage }: { currentPage: number }) {
  return (
    <div className="relative min-h-[820px] bg-[#f7f4ea] font-sans text-[9px] text-slate-800">
      <div className="border-b-2 border-slate-900 bg-white px-4 py-2 text-center">
        <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-500">Freddie Mac Form 70 · Fannie Mae Form 1004</p>
        <h1 className="text-[11px] font-black tracking-tight text-slate-950">Uniform Residential Appraisal Report</h1>
        <p className="text-[8px] text-slate-500">File # LN-2026-9043 · Page {currentPage} of 3</p>
      </div>

      {currentPage === 1 && <PageOne />}
      {currentPage === 2 && <PageTwo />}
      {currentPage === 3 && <PageThree />}
    </div>
  );
}

function Field({
  top,
  left,
  width,
  height,
  label,
  value,
  warn = false,
}: {
  top: number;
  left: number;
  width: number;
  height: number;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`absolute overflow-hidden rounded-sm border px-1.5 py-0.5 ${
        warn ? 'border-rose-400 bg-rose-50' : 'border-slate-400 bg-white'
      }`}
      style={{ top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%` }}
    >
      <p className="text-[7px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`font-semibold leading-tight ${warn ? 'text-rose-800' : 'text-slate-950'}`}>{value}</p>
    </div>
  );
}

function PageOne() {
  return (
    <>
      <div className="grid grid-cols-4 gap-1 border-b border-slate-300 bg-white px-4 py-2 text-[8px]">
        <div>
          <p className="font-bold uppercase text-slate-400">Borrower</p>
          <p className="font-semibold">Sarah K. Vance</p>
        </div>
        <div>
          <p className="font-bold uppercase text-slate-400">FHA case no.</p>
          <p className="font-mono font-semibold">451-904322-B</p>
        </div>
        <div>
          <p className="font-bold uppercase text-slate-400">Lender/client</p>
          <p className="font-semibold">FreeFlow Mortgage Solutions</p>
        </div>
        <div>
          <p className="font-bold uppercase text-slate-400">Effective date</p>
          <p className="font-semibold">08/24/2026</p>
        </div>
      </div>

      <Field
        top={18}
        left={12}
        width={76}
        height={5}
        label="Subject property / contract"
        value="742 Whispering Pines Dr, Austin TX 78745 · Purchase · Contract $425,000 · Seller not owner of record"
      />

      <Field top={26} left={12} width={24} height={5} label="Year built" value="1974 (pre-1978)" warn />
      <Field top={26} left={38} width={24} height={5} label="GLA / beds / baths" value="1,850 sf · 3 / 2" />
      <Field top={26} left={64} width={24} height={5} label="Site / occupancy" value="Fee simple · Owner" />

      <Field
        top={35}
        left={12}
        width={76}
        height={8}
        label="Neighborhood · property values / demand / marketing time"
        value="URAR checked STABLE. Demand/supply in balance. Marketing time < 3 months. 1004MC medians: $350,000 → $342,000 → $330,000 (−5.7%)."
        warn
      />

      <Field top={46} left={12} width={37} height={6} label="Prior sale / transfer" value="07/15/2026 · $200,000 · 17 days before contract" warn />
      <Field top={46} left={51} width={37} height={6} label="Contract date / assignment" value="08/01/2026 · Non-arm’s length family sale" warn />

      <Field top={56} left={12} width={76} height={8} label="Neighborhood description" value="Suburban Austin. Mix of 1960s–1980s ranch product. Leased rooftop solar noted on subject. No view or locational amenities." />
      <Field top={67} left={12} width={76} height={8} label="Site / zoning / highest & best use" value="Zoning SFR. Highest and best use as improved: Yes. Flood zone X. Public water/sewer. Typical for market." />
      <Field top={78} left={12} width={76} height={10} label="Improvements / condition" value="Average Q4/C4. Peeling paint on exterior trim (lead-safe work required). Crawlspace not accessed. Utilities not on at inspection. Attic viewed from hatch only." warn />
    </>
  );
}

function PageTwo() {
  return (
    <>
      <p className="px-4 pt-3 text-[8px] font-black uppercase tracking-wider text-slate-500">Sales comparison approach</p>
      <div className="mx-4 mt-2 overflow-hidden rounded border border-slate-400 bg-white">
        <table className="w-full text-left text-[8px]">
          <thead className="bg-slate-100 text-[7px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1">Feature</th>
              <th className="px-2 py-1">Subject</th>
              <th className="px-2 py-1">Comp 1</th>
              <th className="px-2 py-1">Comp 2</th>
              <th className="px-2 py-1">Comp 3</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            <tr>
              <td className="px-2 py-1 font-semibold">Address</td>
              <td className="px-2 py-1">742 Whispering Pines</td>
              <td className="px-2 py-1">142 Maplewood Ave</td>
              <td className="px-2 py-1">98 Oak Ridge Rd</td>
              <td className="px-2 py-1">33 Clover Lane</td>
            </tr>
            <tr>
              <td className="px-2 py-1 font-semibold">Proximity</td>
              <td className="px-2 py-1">—</td>
              <td className="px-2 py-1">0.45 mi</td>
              <td className="px-2 py-1 text-rose-700">1.20 mi</td>
              <td className="px-2 py-1">0.80 mi</td>
            </tr>
            <tr>
              <td className="px-2 py-1 font-semibold">Sale price</td>
              <td className="px-2 py-1">$425,000</td>
              <td className="px-2 py-1">$425,000</td>
              <td className="px-2 py-1">$410,000</td>
              <td className="px-2 py-1">$435,000</td>
            </tr>
            <tr>
              <td className="px-2 py-1 font-semibold">GLA</td>
              <td className="px-2 py-1">1,850</td>
              <td className="px-2 py-1">1,900</td>
              <td className="px-2 py-1">1,780</td>
              <td className="px-2 py-1">1,840</td>
            </tr>
            <tr>
              <td className="px-2 py-1 font-semibold">Net / gross adj.</td>
              <td className="px-2 py-1">—</td>
              <td className="px-2 py-1">+$15k / 5.9%</td>
              <td className="px-2 py-1 text-rose-700">−$8k / 11.7%</td>
              <td className="px-2 py-1">+$2k / 2.8%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Field
        top={22}
        left={35}
        width={15}
        height={4}
        label="Comp 1 net"
        value="+$15,000"
      />

      <Field
        top={55}
        left={12}
        width={76}
        height={6}
        label="Physical repairs / condition of improvements"
        value="Peeling/chipping paint on eaves and window trim. Pre-1978. Scrape, prime, repaint under lead-safe practices before FHA close."
        warn
      />

      <Field
        top={64}
        left={12}
        width={76}
        height={10}
        label="Comparables commentary"
        value="Comp 2 is West Lake Hills (superior location) with a −$18,000 location adjustment and −$30,000 GLA line. Gross adjustment 11.7% exceeds GSE 10% review threshold. Comp 1 is the primary indicator."
        warn
      />

      <Field top={78} left={12} width={37} height={8} label="Indicated value by sales comparison" value="$425,000" />
      <Field top={78} left={51} width={37} height={8} label="1004MC addendum" value="Attached. Median sale price declining three periods." warn />
    </>
  );
}

function PageThree() {
  return (
    <>
      <p className="px-4 pt-3 text-[8px] font-black uppercase tracking-wider text-slate-500">Reconciliation &amp; certification</p>
      <Field top={14} left={12} width={76} height={8} label="Reconciliation" value="Sales comparison given all weight. Cost approach not developed. Income approach N/A. Appraised value $425,000 as of 08/24/2026." />
      <Field top={26} left={12} width={37} height={8} label="Appraiser" value="Robert J. Miller · TX A-1084 · Supervisory: none" />
      <Field top={26} left={51} width={37} height={8} label="Exposure time" value="30–60 days · Typical of neighborhood" />

      <Field
        top={38}
        left={12}
        width={76}
        height={12}
        label="Additional comments — physical inspection"
        value="Attic viewed from hatch only (not head-and-shoulders). Crawlspace access blocked by stored items — not inspected. Water, electric, and gas were off at inspection. Crawl space shows moisture accumulation and mild dampness. Potential mold spores along baseboards of detached utility closet."
        warn
      />

      <Field
        top={60}
        left={15}
        width={70}
        height={5}
        label="Crawlspace access / MPR"
        value="CRAWLSPACE NOT ACCESSED. FHA 4000.1 head-and-shoulders inspection incomplete."
        warn
      />

      <Field top={70} left={12} width={76} height={12} label="Appraiser certification" value="I certify the statements of fact are correct. I have no present or prospective interest. Hypothetical condition: none. Extraordinary assumption: utilities will function when restored. Digital signature on file." />
    </>
  );
}
