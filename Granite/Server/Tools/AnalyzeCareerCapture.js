// Read-only career protocol inventory and field comparison for HTTP captures.
'use strict';
const Fs = require('node:fs');
const Path = require('node:path');
const Crypto = require('node:crypto');
const { TryParse } = require('../Source/Codec/FieldList');
const { Hex32 } = require('../Source/Core/Crc32');
const Names = require('../Source/Core/Names');

const Relevant = /mycareer|gamestatsv4|\brep\b|experience|progress|overall/i;
function FieldsOf(Parsed) {
    const Occurrences = new Map();
    return Parsed.Fields.map((F) => {
        const Crc = Hex32(F.Crc), Occurrence = Occurrences.get(Crc) || 0;
        Occurrences.set(Crc, Occurrence + 1);
        const Raw = Buffer.isBuffer(F.value) ? F.value : null;
        return {
            key: `${Crc}[${Occurrence}]`, crc: Crc, occurrence: Occurrence,
            name: Names.Resolve(F.Crc), type: F.TypeHex, typeName: F.TypeName,
            data1: F.Data1, data2: F.Data2, status: F.Status || 'ok',
            value: Raw ? { bytes: Raw.length, sha256: Crypto.createHash('sha256').update(Raw).digest('hex') }
                : typeof F.value === 'bigint' ? F.value.toString() : F.value,
        };
    });
}
function Decode(Base, Sidecar, Response = false) {
    const File = `${Base}${Response ? '.response' : ''}.bin`;
    if (!Fs.existsSync(File)) return { status: 'missing', fields: [] };
    const Body = Fs.readFileSync(File);
    if (!Body.length) return { status: 'empty', fields: [] };
    const Declared = Sidecar?.DeclaredFieldListBytes || undefined;
    const Parsed = TryParse(Body, { FieldListSize: Declared });
    if (!Parsed.Ok) return { status: 'error', error: Parsed.Error.message, fields: [] };
    return {
        status: 'ok', bytes: Body.length, fields: FieldsOf(Parsed.Parsed),
        trailingBytes: Parsed.Parsed.Trailing.length,
        trailingSha256: Crypto.createHash('sha256').update(Parsed.Parsed.Trailing).digest('hex'),
    };
}
function Difference(Before, After) {
    const A = new Map(Before.map(F => [F.key, F]));
    const B = new Map(After.map(F => [F.key, F]));
    return [...new Set([...A.keys(), ...B.keys()])].flatMap(Key => {
        const Previous = A.get(Key), Next = B.get(Key);
        // Data offsets may move when strings/binary payloads grow. Compare decoded values and types.
        const Comparable = F => F && JSON.stringify([F.type, F.status, F.value]);
        return Comparable(Previous) === Comparable(Next) ? [] : [{ key: Key, before: Previous || null, after: Next || null }];
    });
}
function Analyze(Directory, Since = '') {
    const Timeline = [], Errors = [], Inventory = new Map(), Previous = new Map();
    for (const Name of Fs.readdirSync(Directory).sort()) {
        if (!Name.endsWith('.json') || Name.endsWith('.response.json') || (Since && Name < Since)) continue;
        const File = Path.join(Directory, Name);
        let Meta;
        try { Meta = JSON.parse(Fs.readFileSync(File, 'utf8').replace(/^\uFEFF/, '')); }
        catch (Error) { Errors.push({ file: Name, error: Error.message }); continue; }
        if (typeof Meta.url !== 'string') continue;
        const Url = new URL(Meta.url, 'https://capture.invalid');
        const Route = Url.pathname.replace(/^\/nba\/[^/]+\//i, '').toLowerCase();
        Inventory.set(Route, (Inventory.get(Route) || 0) + 1);
        if (!Relevant.test(Route)) continue;
        const Base = File.slice(0, -5);
        let ResponseMeta = null;
        try {
            if (Fs.existsSync(`${Base}.response.json`)) ResponseMeta = JSON.parse(Fs.readFileSync(`${Base}.response.json`, 'utf8').replace(/^\uFEFF/, ''));
        } catch (Error) { Errors.push({ file: `${Name.slice(0, -5)}.response.json`, error: Error.message }); }
        try {
            const Request = Decode(Base, Meta), Response = Decode(Base, ResponseMeta, true);
            const Find = Crc => Request.fields.find(F => F.crc === Crc)?.value ?? null;
            const Scope = { session: Url.searchParams.get('x'), slot: Find('0x5EEDA966'), saveId: Find('0xD5E5F21D') };
            const Key = JSON.stringify([Route, Scope]);
            const Prior = Previous.get(Key);
            const Entry = { file: Name, capturedAt: Meta.CapturedAt, route: Route, scope: Scope, request: Request, response: Response };
            if (Prior) {
                Entry.previous = Prior.file;
                Entry.requestChanges = Request.status === 'ok' && Prior.request.status === 'ok'
                    ? Difference(Prior.request.fields, Request.fields) : null;
                Entry.responseChanges = Response.status === 'ok' && Prior.response.status === 'ok'
                    ? Difference(Prior.response.fields, Response.fields) : null;
            }
            Previous.set(Key, Entry);
            Timeline.push(Entry);
        } catch (Error) { Errors.push({ file: Name, error: Error.message }); }
    }
    return {
        directory: Path.resolve(Directory), sinceFilename: Since,
        caveat: 'Unannotated observations; same session/slot/saveId can include slot recreation. Diffs do not establish match boundaries or field semantics. Request and response binaries are reparsed; duplicate CRCs retain occurrence indexes.',
        routes: Object.fromEntries([...Inventory].sort()), errors: Errors, timeline: Timeline,
    };
}
function Main(Args) {
    const Directory = Args[0];
    if (!Directory || Args.includes('--help')) {
        console.log('node Tools/AnalyzeCareerCapture.js <capture-directory> [--since YYYYMMDDHHMMSS] [--output report.json]');
        return;
    }
    function Option(Name) {
        const Index = Args.indexOf(Name);
        if (Index < 0) return undefined;
        if (!Args[Index + 1] || Args[Index + 1].startsWith('--')) throw new Error(`Missing value for ${Name}`);
        return Args[Index + 1];
    }
    const Report = Analyze(Directory, Option('--since') || '');
    const Output = Option('--output');
    const Text = `${JSON.stringify(Report, null, 2)}\n`;
    if (Output) {
        Fs.mkdirSync(Path.dirname(Path.resolve(Output)), { recursive: true });
        Fs.writeFileSync(Output, Text, { flag: 'wx' });
        console.log(`${Report.timeline.length} career observations; ${Report.errors.length} errors; ${Path.resolve(Output)}`);
    } else process.stdout.write(Text);
}
if (require.main === module) {
    try { Main(process.argv.slice(2)); }
    catch (Error) { console.error(Error.message); process.exitCode = 1; }
}
module.exports = { Analyze, Difference, FieldsOf };
