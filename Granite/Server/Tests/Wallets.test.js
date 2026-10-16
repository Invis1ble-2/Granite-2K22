// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Parse, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const Balance = require('../Source/Services/VirtualCurrency/Balance');
const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
const WalletStore = require('../Source/Storage/Wallets');

Test('wallet file preserves account balances as decimal strings across process-style reloads', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-wallets-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const File = Path.join(Root, 'Inventory', 'Wallets.json');
    Assert.equal(WalletStore.Load(File).size, 0, 'missing wallet file starts with no initialized accounts');

    const Wallets = new Map([['42', 123456789012345n], ['43', 0n]]);
    WalletStore.Save(File, Wallets);
    const Document = JSON.parse(Fs.readFileSync(File, 'utf8'));
    Assert.equal(Document.version, 1);
    Assert.equal(Document.accounts['42'], '123456789012345');
    Assert.equal(Document.accounts['43'], '0');
    Assert.deepEqual([...WalletStore.Load(File)], [...Wallets]);
    Assert.deepEqual(Fs.readdirSync(Path.dirname(File)), ['Wallets.json'], 'atomic temporary file is renamed away');
});

Test('corrupt wallet files fail closed instead of resetting saved balances', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-wallets-corrupt-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const File = Path.join(Root, 'Wallets.json');
    for (const Content of ['{', JSON.stringify({ version: 2, accounts: {} }),
        JSON.stringify({ version: 1, accounts: { '42': '-1' } })]) {
        Fs.writeFileSync(File, Content);
        Assert.throws(() => WalletStore.Load(File), /refusing to reset|invalid wallet balance|out of range/);
    }
});

Test('Balance.SetBalance persists normal debits, rolls memory back on write errors, and skips static wallets', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-wallet-balance-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const File = Path.join(Root, 'Wallets.json');
    const Wallets = new Map([['42', 1000n]]);
    const Context = { userId: 42n, Wallets, SaveWallets: () => WalletStore.Save(File, Wallets) };
    Assert.equal(Balance.SetBalance(Context, 750n), 750n);
    Assert.equal(WalletStore.Load(File).get('42'), 750n);

    const Broken = { userId: 42n, Wallets, SaveWallets() { throw new Error('read-only'); } };
    Assert.throws(() => Balance.SetBalance(Broken, 500n), /read-only/);
    Assert.equal(Wallets.get('42'), 750n, 'failed writes do not change the live wallet');

    let Saves = 0;
    const Static = { userId: 43n, Wallets: new Map(), VirtualCurrencyStatic: true, SaveWallets() { Saves++; } };
    Assert.equal(Balance.SetBalance(Static, 1n), Balance.StartingBalance);
    Assert.equal(Saves, 0, 'fixed mode is not written as a decreasing balance');
});

Test('VirtualCurrency purchase writes the debited balance to the wallet file', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-wallet-purchase-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const File = Path.join(Root, 'Wallets.json');
    const Wallets = new Map([['42', 1000n]]);
    WalletStore.Save(File, Wallets);
    const Item = 0x12345678;
    const Context = {
        userId: 42n,
        Wallets,
        VcPrices: new Map([[Item, { price: 250n }]]),
        SaveWallets: () => WalletStore.Save(File, Wallets),
    };
    const Request = new Builder().AddU32(Purchase.ItemCrc, Item).Build();
    const Reply = Parse(Purchase.Build({ Parsed: Parse(Request.Body) }, Context).Body);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(WalletStore.Load(File).get('42'), 750n);
});

Test('HTTP server loads persisted wallets after handler reconstruction and saves purchases without injected state', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-wallet-server-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const WalletsFile = Path.join(Root, 'Inventory', 'Wallets.json');
    WalletStore.Save(WalletsFile, new Map([['42', 1000n]]));
    const Server = require('../Source/Server');
    const ConfigFile = Path.join(Root, 'Config.json');
    Fs.writeFileSync(ConfigFile, JSON.stringify({ WalletsFile: 'Inventory/Wallets.json', VirtualCurrencyStatic: false }));
    const LoadedConfig = Server.LoadConfig(ConfigFile);
    Assert.equal(LoadedConfig.WalletsFile, WalletsFile);
    const Config = {
        ...LoadedConfig,
        CaptureDirectory: Path.join(Root, 'Captures'),
        SessionDirectory: Path.join(Root, 'Sessions'),
        UserContentDirectory: Path.join(Root, 'Content'),
        OwnedItemsFile: Path.join(Root, 'Inventory', 'OwnedItems.json'),
        AutomaticOwnership: false,
        AutomaticOwnershipCatalog: Path.join(Root, 'missing-catalog.json'),
        AttributeProfiles: Path.join(Root, 'Career', 'Profiles.json'),
        CareerAttributes: Path.join(Root, 'Career', 'Attributes.json'),
        CareerOverall: Path.join(Root, 'Career', 'Overall.json'),
        CareerGrind: Path.join(Root, 'Career', 'Grind.json'),
        GatoradeBoostsFile: Path.join(Root, 'Inventory', 'GatoradeBoosts.json'),
        CareerBadgesFile: Path.join(Root, 'Career', 'Badges.json'),
        EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
        MaximumBodyBytes: 1024 * 1024,
    };
    const Request = (Url, Body) => {
        const Req = require('node:stream').Readable.from([Body]);
        Req.url = Url;
        Req.method = 'POST';
        Req.headers = { 'content-length': String(Body.length), vcfieldlist_size: String(Body.length), 'vc-request-id': 'wallet-test' };
        Req.socket = { remoteAddress: '127.0.0.1' };
        const Res = {
            writeHead(Status, Headers) { this.Status = Status; this.Headers = Headers; },
            end(ResponseBody) { this.Body = Buffer.from(ResponseBody); },
        };
        return Server.CreateHandler(Config)(Req, Res).then(() => {
            Assert.equal(Res.Status, 200);
            return Parse(Res.Body, { FieldListSize: Res.Body.length });
        });
    };
    const UserId = Crc32('USERID');
    const Item = 0x12345678;
    const PurchaseRequest = new Builder().AddU64(UserId, 42n).AddU32(Purchase.ItemCrc, Item).Build();
    const Purchased = await Request('/nba/2k19/VirtualCurrency/purchase', PurchaseRequest.Body);
    Assert.equal(GetU32(Purchased.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(WalletStore.Load(WalletsFile).get('42'), 900n);

    const BalanceRequest = new Builder().AddU64(UserId, 42n).Build();
    const AfterRestart = await Request('/nba/2k19/VirtualCurrency/balance', BalanceRequest.Body);
    Assert.equal(GetU64(AfterRestart.Fields, 0x93b1e1e4), 900n);
});
