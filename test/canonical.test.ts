import { describe, expect, test } from "bun:test";
import { CANONICAL_VERSION, canonicalKey, cleanUrl } from "../src/canonical.ts";

const BAH = "https://bah.wd1.myworkdayjobs.com";
const BAH_SLUG = "job/McLean-VA/University--2027-Summer-Games-Software-Developer-Intern---McLean--VA";
const KLA_SLUG = "job/Milpitas-CA/Algorithm-Engineering-Intern--AI--Computer-Vision---Software-Engineering-";
const HP_SLUG = "job/Corvallis-Oregon-United-States-of-America/Software-and-Engineering-Intern-Roles---Imaging-and-Print";
const VISA_SLUG = "job/US---Austin-TX/Software-Engineer--Intern---2027-Austin--TX";
const WF_SLUG = "XMLNAME-2027-Technology-Summer-Internship---Early-Careers--Software-Engineering---California-";
const UKG_BOARD = "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0d5f3c1e-7a2b-4c9d-8e1f-2a3b4c5d6e7f";

describe("cleanUrl", () => {
  test("cuts trailing HTML junk", () => {
    expect(cleanUrl("https://boards.greenhouse.io/figma/jobs/6143238004?gh_jid=6143238004%22%3E%3Cimg")).toBe(
      "https://boards.greenhouse.io/figma/jobs/6143238004?gh_jid=6143238004",
    );
    expect(cleanUrl('https://jobs.lever.co/acme/1"><img src="x">')).toBe("https://jobs.lever.co/acme/1");
    expect(cleanUrl("https://example.com/job/1<br>")).toBe("https://example.com/job/1");
    expect(cleanUrl("https://example.com/job/1%3cbr%3e")).toBe("https://example.com/job/1");
  });

  test("trims and adds a missing scheme", () => {
    expect(cleanUrl("  https://example.com/job/1\n")).toBe("https://example.com/job/1");
    expect(cleanUrl("jobs.lever.co/acme/2ad02ce3-1d56-4aee-9f1d-5199c780c0c1")).toBe(
      "https://jobs.lever.co/acme/2ad02ce3-1d56-4aee-9f1d-5199c780c0c1",
    );
  });

  test("keeps http as displayed", () => {
    expect(cleanUrl("http://prizepicks.com/position?gh_jid=7999266003")).toBe(
      "http://prizepicks.com/position?gh_jid=7999266003",
    );
  });

  test("rejects non-http URLs and garbage", () => {
    expect(cleanUrl("mailto:jobs@example.com")).toBeUndefined();
    expect(cleanUrl("javascript:alert(1)")).toBeUndefined();
    expect(cleanUrl("ftp://example.com/job/1")).toBeUndefined();
    expect(cleanUrl("")).toBeUndefined();
    expect(cleanUrl('"><img')).toBeUndefined();
    expect(cleanUrl("/jobs/123")).toBeUndefined();
    expect(cleanUrl("Closed")).toBeUndefined();
  });
});

describe("canonicalKey: career domains that front an ATS", () => {
  test("SIG's site and its iCIMS portal", () => {
    expect(canonicalKey("https://careers.sig.com/jobs/10822")).toBe(
      canonicalKey("https://careers-sig.icims.com/jobs/10822/login"),
    );
  });

  test("career sites that show the Workday requisition or Greenhouse id", () => {
    const pairs = [
      [
        "https://bah.wd1.myworkdayjobs.com/en-US/BAH_Jobs/job/Rome-NY/University--2027-Summer-Games-Software-Developer-Intern---Rome--NY_R0248141",
        "https://careers.boozallen.com/jobs/JobDetail/Rome-University-2027-Summer-Games-Software-Developer-Intern-R0248141/129566",
      ],
      [
        "https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/San-Jose-California-US/Software-Engineer-Intern_2024683",
        "https://careers.cisco.com/global/en/job/2024683/Software-Engineer-Intern",
      ],
      ["https://job-boards.greenhouse.io/hellofresh/jobs/7848068", "https://careers.hellofresh.com/global/en/job/7848068/Data-Intern"],
      ["https://careers-simventions.icims.com/jobs/1631/software/job", "https://simventions.jibeapply.com/jobs/1631"],
      ["https://careers-steeldynamics.icims.com/jobs/8017/intern/job", "https://careers-aluminumdynamics.icims.com/jobs/8017/intern/job"],
      ["https://innovativesystems.applytojob.com/apply/wJuSCjOOqx/Intern", "https://career.innovativesystems.com/apply/wJuSCjOOqx/Intern"],
    ];
    for (const [a, b] of pairs) expect(canonicalKey(a!)).toBe(canonicalKey(b!));
    // A Booz Allen slug without a requisition keeps its Avature key.
    expect(canonicalKey("https://careers.boozallen.com/jobs/JobDetail/Software-Developer-Intern/129513")).toBe(
      "avature:boozallen:129513",
    );
  });

  test("Dell's site and its Oracle tenant", () => {
    const path = "/hcmUI/CandidateExperience/en/sites/careers/job/297797";
    expect(canonicalKey(`https://enterpriseplatform.dell.com${path}`)).toBe(
      canonicalKey(`https://iawmqy.fa.ocs.oraclecloud.com${path}`),
    );
  });
});

describe("canonicalKey: same job", () => {
  const cases: [string, string, string, string][] = [
    [
      "KLA site and repost suffix",
      `https://kla.wd1.myworkdayjobs.com/UR/${KLA_SLUG}_2641392-1`,
      `https://kla.wd1.myworkdayjobs.com/en-US/Search/${KLA_SLUG}_2641392-2`,
      "wd:kla:2641392",
    ],
    [
      "HP career sites",
      `https://hp.wd5.myworkdayjobs.com/ExternalCareerSite/${HP_SLUG}_3168142-1`,
      `https://hp.wd5.myworkdayjobs.com/en-US/exteu-ac-careersite/${HP_SLUG}_3168142`,
      "wd:hp:3168142",
    ],
    [
      "Visa letter-suffixed requisition",
      `https://visa.wd5.myworkdayjobs.com/Visa/${VISA_SLUG}_REF088544W-1`,
      `https://visa.wd5.myworkdayjobs.com/en-US/visa_early_careers/${VISA_SLUG}_REF088544W`,
      "wd:visa:REF088544W",
    ],
    [
      "BAH locale and site case",
      `${BAH}/en-US/BAH_Jobs/${BAH_SLUG}_R0249827`,
      `${BAH}/bah_jobs/${BAH_SLUG}_R0249827`,
      "wd:bah:R0249827",
    ],
    [
      "Workday apply actions",
      `${BAH}/bah_jobs/${BAH_SLUG}_R0249827/apply/applyManually`,
      `${BAH}/bah_jobs/${BAH_SLUG}_R0249827`,
      "wd:bah:R0249827",
    ],
    [
      "myworkdaysite with and without a locale",
      `https://wd1.myworkdaysite.com/en-US/recruiting/wf/WellsFargoJobs/details/${WF_SLUG}_R-574294`,
      `https://wd1.myworkdaysite.com/recruiting/wf/WellsFargoJobs/job/SAN-FRANCISCO-CA/${WF_SLUG}_R-574294`,
      "wd:wf:R-574294",
    ],
    [
      "myworkdaysite and myworkdayjobs",
      "https://wd5.myworkdaysite.com/en-US/recruiting/guidewire/external/job/United-States---Philadelphia-PA/AI-Engineering-Intern_JR_14530",
      "https://guidewire.wd5.myworkdayjobs.com/external/job/United-States---Philadelphia-PA/AI-Engineering-Intern_JR_14530",
      "wd:guidewire:JR_14530",
    ],
    [
      "Ashby application page",
      "https://jobs.ashbyhq.com/fab2/2b0ab443-c7d8-4547-9766-111747f0b361/application?embed=true",
      "https://jobs.ashbyhq.com/Fab2/2b0ab443-c7d8-4547-9766-111747f0b361",
      "ashby:2b0ab443-c7d8-4547-9766-111747f0b361",
    ],
    [
      "Waymo gh_jid and job board",
      "https://careers.withwaymo.com/jobs?gh_jid=8208465",
      "https://job-boards.greenhouse.io/waymo/jobs/8208465",
      "gh:8208465",
    ],
    [
      "AQR duplicated gh_jid",
      "https://careers.aqr.com/jobs?gh_jid=8077110&gh_jid=8077110",
      "https://careers.aqr.com/jobs?gh_jid=8077110",
      "gh:8077110",
    ],
    [
      "PrizePicks http and https",
      "http://prizepicks.com/position?gh_jid=7999266003",
      "https://www.prizepicks.com/position?gh_jid=7999266003",
      "gh:7999266003",
    ],
    [
      "Figma junk suffix",
      cleanUrl("https://boards.greenhouse.io/figma/jobs/6143238004?gh_jid=6143238004%22%3E%3Cimg")!,
      "https://boards.greenhouse.io/figma/jobs/6143238004",
      "gh:6143238004",
    ],
    [
      "iCIMS slug and mobile",
      "https://careers-berkley.icims.com/jobs/14437/software-developer-%28java%29-intern-%7c-june-2027/job",
      "https://careers-berkley.icims.com/jobs/14437/job?mobile=true&needsRedirect=false",
      "icims:careers-berkley.icims.com:14437",
    ],
    [
      "SmartRecruiters slug and bare id",
      "https://jobs.smartrecruiters.com/BoschGroup/744000146546849-software-engineering-intern-8-months-40hrs-per-week-?oga=true",
      "https://jobs.smartrecruiters.com/BoschGroup/744000146546849",
      "sr:744000146546849",
    ],
    [
      "Amazon slug and apply",
      "https://amazon.jobs/en/jobs/10559746/software-development-engineer-intern-summer-2027-usa-amazon-dedicated-cloud-adc",
      "https://www.amazon.jobs/jobs/10559746/apply",
      "amazon:10559746",
    ],
    [
      "Jobvite param order",
      "https://jobs.jobvite.com/aarete/job/oBXLAfwD?fr=false&nl=1&nl=1",
      "https://jobs.jobvite.com/aarete/job/oBXLAfwD?nl=1&nl=1&fr=false",
      "jobvite:oBXLAfwD",
    ],
    [
      "Lever apply",
      "https://jobs.lever.co/kepler/2ad02ce3-1d56-4aee-9f1d-5199c780c0c1/apply",
      "https://jobs.lever.co/kepler/2ad02ce3-1d56-4aee-9f1d-5199c780c0c1",
      "lever:2ad02ce3-1d56-4aee-9f1d-5199c780c0c1",
    ],
    [
      "Jane Street position page and Greenhouse",
      "https://janestreet.com/join-jane-street/position/8599644002",
      "https://job-boards.greenhouse.io/janestreet/jobs/8599644002",
      "gh:8599644002",
    ],
    [
      "Jane Street position and apply pages",
      "https://www.janestreet.com/join-jane-street/position/8589868002",
      "https://www.janestreet.com/join-jane-street/apply/8589868002?gh_jid=8589868002",
      "gh:8589868002",
    ],
    [
      "Paylocity tracking param",
      "https://recruiting.paylocity.com/Recruiting/Jobs/Details/4501273?jr_id=699e5497e0bddb6acacdc920",
      "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4501273",
      "paylocity:4501273",
    ],
    [
      "Breezy slug and apply",
      "https://ninjaholdings.breezy.hr/p/23a015fea536-software-engineer-intern",
      "https://ninjaholdings.breezy.hr/p/23a015fea536/apply",
      "breezy:ninjaholdings:23a015fea536",
    ],
    [
      "Tesla bare id and slug",
      "https://www.tesla.com/careers/search/job/269198",
      "https://www.tesla.com/careers/search/job/internship-software-engineering-people-systems-fall-2026-269198",
      "tesla:269198",
    ],
    [
      "Taleo job number case",
      "https://massanf.taleo.net/careersection/ex/jobdetail.ftl?job=260001IY",
      "https://massanf.taleo.net/careersection/ex/jobdetail.ftl?job=260001iy&lang=en",
      "taleo:massanf:260001IY",
    ],
    [
      "Avature jobId param and path",
      "https://ibmglobal.avature.net/en_US/careers/JobDetail?jobId=86158",
      "https://ibmglobal.avature.net/en_US/careers/JobDetail/Software-Developer-Intern/86158",
      "avature:ibmglobal:86158",
    ],
    [
      "Avature custom domain and avature.net",
      "https://careers.twosigma.com/careers/JobDetail/New-York-New-York-United-States-Software-Engineering-Internship-Summer-2027/14016",
      "https://twosigma.avature.net/careers/JobDetail/14016",
      "avature:twosigma:14016",
    ],
    [
      "IMC site and Greenhouse",
      "https://imc.com/us/careers/jobs/4823924101",
      "https://job-boards.eu.greenhouse.io/imc/jobs/4823924101",
      "gh:4823924101",
    ],
    [
      "Voloridge site and Greenhouse",
      "https://voloridge.com/jobs/voloridgeinvestmentmanagement/4224862009",
      "https://job-boards.greenhouse.io/voloridgeinvestmentmanagement/jobs/4224862009",
      "gh:4224862009",
    ],
    [
      "Epic Games site with and without gh_jid",
      "https://epicgames.com/site/careers/jobs/6173862004",
      "https://epicgames.com/careers/jobs/6173862004?gh_jid=6173862004",
      "gh:6173862004",
    ],
    [
      "Trillium apply page with and without gh_jid",
      "https://trlm.com/apply/5207089007",
      "https://www.trlm.com/apply/5207089007?gh_jid=5207089007",
      "gh:5207089007",
    ],
    [
      "Appian site and Greenhouse",
      "https://careers.appian.com/jobs/8041243-product-manager-intern-",
      "https://job-boards.greenhouse.io/appian/jobs/8041243",
      "gh:8041243",
    ],
    [
      "SuccessFactors job page and talent community apply",
      "https://jobs.grainger.com/talentcommunity/apply/1419930800?locale=en_US",
      "https://jobs.grainger.com/job/CHICAGO-GTG-Intern-Software-Engineer-IL-60661-4555/1419930800/?ats=successfactors",
      "sf:jobs.grainger.com:1419930800",
    ],
    [
      "Oracle custom domain with a letter-prefixed id",
      "https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/R273257",
      "https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/r273257/",
      "oracle:iawmqy:R273257",
    ],
  ];

  for (const [name, a, b, key] of cases) {
    test(name, () => {
      expect(canonicalKey(a)).toBe(key);
      expect(canonicalKey(b)).toBe(key);
    });
  }
});

describe("canonicalKey: different jobs", () => {
  const cases: [string, string, string][] = [
    ["BAH neighbouring requisitions", `${BAH}/bah_jobs/${BAH_SLUG}_R0249827`, `${BAH}/bah_jobs/${BAH_SLUG}_R0249828`],
    [
      "HRT gh_jid",
      "https://hudsonrivertrading.com/careers/job?gh_jid=8222414",
      "https://hudsonrivertrading.com/careers/job?gh_jid=8222413",
    ],
    [
      "Clearwater",
      "https://clearwateranalytics.wd1.myworkdayjobs.com/Clearwater_Analytics_Careers/job/Office---Chicago/Software-Development-Intern_R12188",
      "https://clearwateranalytics.wd1.myworkdayjobs.com/Clearwater_Analytics_Careers/job/Office---Chicago/Software-Development-Intern_R12187",
    ],
    [
      "Leidos dashed requisitions",
      "https://leidos.wd5.myworkdayjobs.com/External/job/Annapolis-Junction-MD/Software-Developer-Intern_R-00192858",
      "https://leidos.wd5.myworkdayjobs.com/External/job/Tucson-AZ/Jr-Software-Engineer-Intern_R-00192184",
    ],
    [
      "Insulet year-prefixed requisitions",
      "https://insulet.wd5.myworkdayjobs.com/insuletcareers/job/San-Diego-California/Intern--DevOps-Engineer--June-August-2027--Onsite-_REQ-2026-18202",
      "https://insulet.wd5.myworkdayjobs.com/en-US/insuletcareers/job/Acton-Massachusetts/Co-op--DevOps-Engineer--January---June-2027--Hybrid-_REQ-2026-18027",
    ],
    [
      "AskBio short requisitions",
      "https://askbio.wd12.myworkdayjobs.com/AskBio/job/Durham-NC/Intern--IT--AI-Team--Data_R26-27",
      "https://askbio.wd12.myworkdayjobs.com/AskBio/job/Durham-NC/Intern-Data-Management_R26-47",
    ],
    [
      "Microchip two-digit suffixes",
      "https://wd5.myworkdaysite.com/recruiting/microchiphr/External/job/OR---Gresham/Intern--Equipment-Technician--Bulk-Chemical-_R2120-25",
      "https://wd5.myworkdaysite.com/recruiting/microchiphr/External/job/OR---Gresham/Intern--Equipment-Technician--Bulk-Chemical-_R2120-26",
    ],
    [
      "IBM jobId",
      "https://careers.ibm.com/careers/JobDetail?jobId=133801",
      "https://careers.ibm.com/careers/JobDetail?jobId=133782",
    ],
    [
      "Energy Northwest underscore requisitions",
      "https://energynorthwest.wd1.myworkdayjobs.com/External/job/Richland-WA/Data-Architecture-Intern_REQ26_23",
      "https://energynorthwest.wd1.myworkdayjobs.com/External/job/Richland-WA/Engineering-Intern_REQ26_26",
    ],
    [
      "UKG opportunities on one board",
      `${UKG_BOARD}/OpportunityDetail?opportunityId=5b0c7d1e-3f4a-4b5c-9d6e-7f8a9b0c1d2e`,
      `${UKG_BOARD}/OpportunityDetail?opportunityId=8e9f0a1b-2c3d-4e5f-a6b7-c8d9e0f1a2b3`,
    ],
    [
      "same requisition number in two Workday tenants",
      "https://wd5.myworkdaysite.com/en-US/recruiting/guidewire/external/job/Toronto/Front-End-Developer-Intern_JR_14453",
      "https://wd5.myworkdaysite.com/en-US/recruiting/otherco/external/job/Toronto/Developer-Intern_JR_14453",
    ],
    [
      "Taleo alphanumeric job numbers",
      "https://jacobs.taleo.net/careersection/ex3/jobdetail.ftl?job=ADV000CKF",
      "https://jacobs.taleo.net/careersection/ex3/jobdetail.ftl?job=ADV000CKE",
    ],
    [
      "Breezy tenants",
      "https://ninjaholdings.breezy.hr/p/23a015fea536-software-engineer-intern",
      "https://lufco.breezy.hr/p/23a015fea536-software-engineer-intern",
    ],
    [
      "same iCIMS id on two portals",
      "https://careers-daytonfreight.icims.com/jobs/18249/software-developer-intern/job",
      "https://careers-heart.icims.com/jobs/18249/intern%2c-data-science%2c-biostatistics-remote/job",
    ],
    [
      "same Avature id for two tenants",
      "https://twosigma.avature.net/careers/JobDetail/14096",
      "https://ibmglobal.avature.net/en_US/careers/JobDetail?jobId=14096",
    ],
    [
      "same Oracle id for two tenants",
      "https://fa-etbx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/nfcu/job/32354",
      "https://ecnf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/32354",
    ],
    [
      "ZIP code at the end of a slug",
      "https://careers.example.com/job/Software-Engineer-Intern-TX-75219",
      "https://careers.example.com/job/Data-Analyst-Intern-TX-75219",
    ],
  ];

  for (const [name, a, b] of cases) {
    test(name, () => {
      expect(canonicalKey(a)).not.toBe(canonicalKey(b));
    });
  }

  test("keeps Workday requisitions whole", () => {
    expect(canonicalKey(cases[3]![1])).toBe("wd:leidos:R-00192858");
    expect(canonicalKey(cases[4]![1])).toBe("wd:insulet:REQ-2026-18202");
    expect(canonicalKey(cases[5]![1])).toBe("wd:askbio:R26-27");
    expect(canonicalKey(cases[6]![1])).toBe("wd:microchiphr:R2120-25");
    expect(canonicalKey(cases[8]![1])).toBe("wd:energynorthwest:REQ26_23");
  });

  test("UKG keys use the opportunity, not the board", () => {
    expect(canonicalKey(cases[9]![1])).toBe("url:recruiting.ultipro.com:5b0c7d1e-3f4a-4b5c-9d6e-7f8a9b0c1d2e");
  });
});

describe("canonicalKey: one real URL per typed rule", () => {
  const cases: [string, string][] = [
    ["https://stripe.com/jobs/search?gh_jid=8186442", "gh:8186442"],
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=4704820006", "gh:4704820006"],
    ["https://acme.com/careers?ashby_jid=b66be397-240b-41a6-9b05-493299b270a9", "ashby:b66be397-240b-41a6-9b05-493299b270a9"],
    ["https://ats.rippling.com/rippling/jobs/a07e4e46-3721-4934-b57b-0d58412e22ba", "rippling:a07e4e46-3721-4934-b57b-0d58412e22ba"],
    ["https://careers-sig.icims.com/jobs/11555/login", "icims:careers-sig.icims.com:11555"],
    ["https://careers.amd.com/jobs/90997?icims=1", "icims:careers.amd.com:90997"],
    ["https://jobs.smartrecruiters.com/FortuneBrands/744000151692989", "sr:744000151692989"],
    ["https://ecnf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/301932", "oracle:ecnf:301932"],
    [
      "https://fa-exjq-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/SHEIN/job/USA73475043",
      "oracle:fa-exjq-saasfaprod1:USA73475043",
    ],
    ["https://energytransfer.taleo.net/careersection/etp_ext/jobdetail.ftl?job=2610003535", "taleo:energytransfer:2610003535"],
    ["https://qualcomm.eightfold.ai/careers/job/446721229661", "eightfold:qualcomm:446721229661"],
    ["https://careers.ibm.com/careers/JobDetail?jobId=134067", "ibm:134067"],
    ["https://apply.deloitte.com/en_US/careers/JobDetail/Summer-Scholar-AI-and-Data-Engineering/362479", "avature:deloitte:362479"],
    ["https://apply.careers.microsoft.com/careers/job/1970393557004836", "msft:1970393557004836"],
    ["https://careers.itw.com/global/en/job/JR10261", "phenom:careers.itw.com:JR10261"],
    ["https://careers.zimmerbiomet.com/us/en/job/12746", "phenom:careers.zimmerbiomet.com:12746"],
    [
      "https://corningjobs.corning.com/job/Corning-Intern,-Measurements-Summer-2027-NY-14831/1433453700?ats=successfactors",
      "sf:corningjobs.corning.com:1433453700",
    ],
    ["https://lifeattiktok.com/search/7688770038477801733", "bytedance:7688770038477801733"],
    ["https://joinbytedance.com/search/7688841262493485365", "bytedance:7688841262493485365"],
    ["https://www.metacareers.com/jobs/1183817733250704", "meta:1183817733250704"],
    [
      "https://google.com/about/careers/applications/jobs/results/134770032394543814-associate-product-manager-intern-summer-2027",
      "google:134770032394543814",
    ],
    ["https://jobs.apple.com/en-us/details/200682357", "apple:200682357"],
    ["http://camba.applytojob.com/apply/wv3YppWJJF/Internship-Developer-Learning-To-Work-Program", "jazz:wv3YppWJJF"],
    ["https://apply.workable.com/cogna/j/45A6283F88/apply", "workable:45A6283F88"],
    ["https://lunaroutpost.bamboohr.com/careers/391", "bamboo:lunaroutpost:391"],
    [
      "https://franklin-electric.pinpointhq.com/en/postings/a8e0afdd-63ce-4817-aaca-056018010f06?ats=pinpointhq",
      "pinpoint:a8e0afdd-63ce-4817-aaca-056018010f06",
    ],
    ["https://higher.gs.com/roles/171563?type=students", "gs:171563"],
    ["https://www.janestreet.com/join-jane-street/position/8589868002", "gh:8589868002"],
  ];

  for (const [url, key] of cases) {
    test(key, () => {
      expect(canonicalKey(url)).toBe(key);
    });
  }
});

describe("canonicalKey: generic keys", () => {
  test("drops noise params, the fragment, www, the trailing slash and the scheme", () => {
    const key = "url:citadel.com/careers/details/software-engineer-intern-us";
    expect(canonicalKey("https://citadel.com/careers/details/software-engineer-intern-us")).toBe(key);
    expect(canonicalKey("http://www.citadel.com/careers/details/software-engineer-intern-us/")).toBe(key);
    expect(
      canonicalKey(
        "https://WWW.Citadel.com/careers/details/software-engineer-intern-us/?utm_source=x&utm_medium=y&ref=abc&gh_src=1&lang=en#apply",
      ),
    ).toBe(key);
  });

  test("sorts and deduplicates the remaining params", () => {
    const key = "url:example.com/careers?level=intern&team=ml";
    expect(canonicalKey("https://example.com/careers?team=ml&level=intern")).toBe(key);
    expect(canonicalKey("https://example.com/careers?level=intern&team=ml&team=ml&source=li")).toBe(key);
  });

  test("never drops a meaningful param", () => {
    expect(canonicalKey("https://example.com/careers?team=ml")).not.toBe(
      canonicalKey("https://example.com/careers?team=web"),
    );
  });

  test("uses an id-like param", () => {
    expect(
      canonicalKey(
        "https://jobs.ubs.com/TGnewUI/Search/home/HomeWithPreLoad?PageType=JobDetails&jobId=350190&partnerid=25008&siteid=5131",
      ),
    ).toBe("url:jobs.ubs.com:350190");
    expect(
      canonicalKey(
        "https://careers.point72.com/CSJobDetail?jobCode=CSS-0012293&jobName=summer-2027-quantitative-developer-internship",
      ),
    ).toBe("url:careers.point72.com:CSS-0012293");
  });

  test("uses a numeric path id", () => {
    expect(canonicalKey("https://drw.com/work-at-drw/listings/software-developer-intern-3466687")).toBe(
      "url:drw.com:3466687",
    );
    expect(canonicalKey("https://www.uber.com/global/en/careers/list/155032/")).toBe("url:uber.com:155032");
    expect(
      canonicalKey(
        "https://careers.bankofamerica.com/en-us/students/job-detail/14420/quantitative-data-analyst-summer-analyst-program-multiple-locations",
      ),
    ).toBe("url:careers.bankofamerica.com:14420");
    expect(
      canonicalKey(
        "https://jobs.intuit.com/job/mountain-view/summer-2027-software-engineering-intern-cybersecurity/27595/100620927616",
      ),
    ).toBe("url:jobs.intuit.com:100620927616");
  });

  test("never takes a ZIP code from a slug", () => {
    expect(canonicalKey("https://careers.example.com/job/Software-Engineer-Intern-TX-75219/")).toBe(
      "url:careers.example.com/job/software-engineer-intern-tx-75219",
    );
  });

  test("never takes digits from a UUID", () => {
    const gusto = "https://jobs.gusto.com/postings/acme-llc-software-intern-bc91da14-6a89-4532-9ee0-367001518342";
    expect(canonicalKey(gusto)).toBe(`url:${gusto.slice("https://".length)}`);
  });

  test("keeps unparseable input as a raw key", () => {
    expect(canonicalKey(" Not a URL ")).toBe("raw:not a url");
  });
});

test("CANONICAL_VERSION stays 1 until a database exists", () => {
  expect(CANONICAL_VERSION).toBe(1);
});
