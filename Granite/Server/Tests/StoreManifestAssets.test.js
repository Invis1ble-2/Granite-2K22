'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { Readable } = require('node:stream');
const { CreateHandler } = require('../Source/Server');
const Cdn = require('../Source/Services/Cdn/File');
const { ManifestAssetStore } = require('../Source/Services/Cdn/ManifestAssetStore');

function BuildFixture(Root, Relative = 'clothing/small/test_texture.iff') {
    const Asset = Buffer.from('PK\x03\x04fixture-zip-byte');
    const Padding = Buffer.from('BASE');
    const Shard = Path.join(Root, '0C');
    Fs.writeFileSync(Shard, Buffer.concat([Padding, Asset]));
    const Manifest = Path.join(Root, 'manifest');
    Fs.writeFileSync(Manifest, `0C [pad_file] 90 1\n0C ${Relative} 91 ${Asset.length / 4}\n`);
    return { Asset, Manifest, Relative, Shard };
}

Test('manifest asset reader applies 4x offsets and rejects non-store paths', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'store-manifest-assets-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Fixture = BuildFixture(Root);
    const Store = new ManifestAssetStore(Fixture.Manifest);

    Assert.equal(Cdn.Normalise(`/nba/2k19/${Fixture.Relative}?x=1`), Fixture.Relative);
    Assert.equal(Cdn.Normalise('/nba/2k19/../../secrets.iff'), null);
    Assert.deepEqual(await Store.Read(Fixture.Relative), Fixture.Asset);
    Assert.deepEqual(await Store.Read(Fixture.Relative.toUpperCase()), Fixture.Asset);
    Assert.equal(await Store.Read('store/thumbnails/missing.iff'), null);
    Assert.equal(await Store.Read('../outside.iff'), null);
});

Test('HTTP dispatcher serves a case-insensitive 2K22 thumbnail for GET and HEAD', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'store-manifest-route-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Fixture = BuildFixture(Root, 'store/thumbnails/test_texture.iff');
    const Handler = CreateHandler({
        CaptureDirectory: Path.join(Root, 'captures'),
        SessionDirectory: Path.join(Root, 'sessions'),
        UserContentDirectory: Path.join(Root, 'usercontent'),
        CdnDirectory: Path.join(Root, 'cdn'),
        StoreAssetManifest: Fixture.Manifest,
        MaximumBodyBytes: 1024,
        AutomaticOwnershipCatalog: Path.join(Root, 'missing-catalog.json'),
        CareerAttributes: Path.join(Root, 'missing-careers.json'),
        AttributeProfiles: Path.join(Root, 'missing-profiles.json'),
        CareerOverall: Path.join(Root, 'missing-overalls.json'),
        CareerGrind: Path.join(Root, 'missing-grind.json'),
        CareerBadgesFile: Path.join(Root, 'missing-badges.json'),
    }, { Careers: new Map(), Wallets: new Map(), OwnedItems: new Map() });
    const MakeRequest = Method => {
        const Req = Readable.from([]);
        Req.method = Method;
        Req.url = `/nba/2k19/${Fixture.Relative.toUpperCase()}?x=manifest-test`;
        Req.headers = {};
        return Req;
    };
    const MakeResponse = () => ({
        headers: null,
        statusCode: null,
        Body: null,
        writeHead(Status, Headers) { this.statusCode = Status; this.headers = Headers; },
        end(Body) { this.Body = Body === undefined ? Buffer.alloc(0) : Buffer.from(Body); },
    });

    const GetResponse = MakeResponse();
    await Handler(MakeRequest('GET'), GetResponse);
    Assert.equal(GetResponse.statusCode, 200);
    Assert.equal(GetResponse.headers['Content-Type'], 'application/octet-stream');
    Assert.equal(GetResponse.headers['Content-Length'], String(Fixture.Asset.length));
    Assert.deepEqual(GetResponse.Body, Fixture.Asset);

    const HeadResponse = MakeResponse();
    await Handler(MakeRequest('HEAD'), HeadResponse);
    Assert.equal(HeadResponse.statusCode, 200);
    Assert.equal(HeadResponse.headers['Content-Length'], String(Fixture.Asset.length));
    Assert.equal(HeadResponse.Body.length, 0, 'HEAD returns headers only');
});

Test('manifest case-folded aliases reject conflicting locations', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'store-manifest-conflict-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Fixture = BuildFixture(Root);
    Fs.appendFileSync(Fixture.Manifest, `0C ${Fixture.Relative.toUpperCase()} 92 1\n`);
    await Assert.rejects(new ManifestAssetStore(Fixture.Manifest).Read(Fixture.Relative), /conflicting asset paths/);
});
