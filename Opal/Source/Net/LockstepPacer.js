// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Input, History, FakeFramesToRetire, Frame: BuildFrame, BuildFakeBody } = require('./LockstepDelay');
const Log = require('../Core/Log');
const { performance: Perf } = require('node:perf_hooks');
const MaxCatchupTicks = 4;
const StallMs = 2000;

class Pacer {
    constructor(Hz = 0) {
        if (!Number.isInteger(Hz) || Hz < 0 || Hz > 240)
            throw new Error('lockstep pacing Hz must be 0 (native) or 1..240');
        this.Hz = Hz;
        this.Sessions = new Map();
        this.PendingDrops = new Map();
        this.Released = 0;
        this.NextClockId = 1;
    }

    MarkDroppedSlot(Session, Slot) {
        if (!Session || !Number.isInteger(Slot) || Slot < 0 || Slot >= Session.Counts.length || !Session.Counts[Slot])
            return false;
        if (Session.RetiredSlots.has(Slot) || Session.DroppedSlots.has(Slot)) return false;
        Session.DroppedSlots.add(Slot);
        Session.StallingSlots.delete(Slot);
        for (const [FrameIndex, FrameMap] of Session.Pending) {
            if (FrameIndex >= Session.Next) FrameMap.delete(Slot);
        }
        return true;
    }

    ApplyPendingDrops(Key, Session) {
        const Drops = this.PendingDrops.get(Key);
        if (!Drops || !Drops.size) return;
        for (const [Index, Source] of Session.Sources) {
            if (Drops.delete(Source.MachineId)) this.MarkDroppedSlot(Session, Index);
        }
        if (!Drops.size) {
            this.PendingDrops.delete(Key);
            return;
        }
        const TotalSlots = Session.Counts.reduce((Sum, Count) => Sum + (Count ? 1 : 0), 0);
        if (Session.Sources.size > 0 && Session.Sources.size + Drops.size >= TotalSlots) {
            Session.Counts.forEach((Count, Index) => {
                if (Count && !Session.Sources.has(Index)) this.MarkDroppedSlot(Session, Index);
            });
            this.PendingDrops.delete(Key);
        }
    }

    DropMachine(SessionKey, MachineId) {
        if (!SessionKey || MachineId === null || MachineId === undefined) return false;
        const Target = BigInt(MachineId);
        const Session = this.Sessions.get(SessionKey);
        if (Session) {
            for (const [Index, Source] of Session.Sources) {
                if (Source.MachineId === Target) return this.MarkDroppedSlot(Session, Index);
            }
        }
        let Drops = this.PendingDrops.get(SessionKey);
        if (!Drops) this.PendingDrops.set(SessionKey, (Drops = new Set()));
        Drops.add(Target);
        if (Session) this.ApplyPendingDrops(SessionKey, Session);
        return true;
    }

    CloseSession(SessionKey) {
        this.PendingDrops.delete(SessionKey);
        return this.Sessions.delete(SessionKey);
    }

    LookupFake(SessionKey, Slot, Wire) {
        const Session = this.Sessions.get(SessionKey);
        const Cached = Session?.FakeHistory.get(Slot)?.get(Wire & 0xff);
        if (!Cached || Cached.Absolute >= Session.Next || Cached.Absolute <= Session.Next - History) return null;
        return Cached;
    }

    Queue(Delivery, Type) {
        const Source = Delivery.Source;
        const Key = Source.SessionKey;
        let Session = this.Sessions.get(Key);
        if (!Session) {
            Session = {
                Rate: this.Hz || Source.Lockstep.FrameRate,
                NativeRate: Source.Lockstep.FrameRate,
                Counts: Source.Lockstep.Counts,
                Next: 0,
                Deadline: null,
                Pending: new Map(),
                Sources: new Map(),
                DroppedSlots: new Set(),
                StallingSlots: new Set(),
                RetiredSlots: new Set(),
                FakeCounts: new Array(Source.Lockstep.Counts.length).fill(0),
                FakeHistory: new Map(),
                WaitFrame: null,
                WaitSince: null,
                Id: this.NextClockId++,
                Released: 0,
                SummaryAt: null,
            };
            this.Sessions.set(Key, Session);
        }
        if (Session.NativeRate !== Source.Lockstep.FrameRate ||
            Session.Counts.length !== Source.Lockstep.Counts.length ||
            !Session.Counts.every((N, I) => N === Source.Lockstep.Counts[I]))
            throw new Error('lockstep frame rates or controller maps disagree');
        if (Delivery.FrameIndex < Session.Next) {
            return Delivery.Retransmit ? [{ ...Delivery, Type: Type }] : [];
        }
        if (Delivery.Retransmit) return [];
        const Index = Source.Lockstep.Index;
        const PreviousSource = Session.Sources.get(Index);
        if (PreviousSource && PreviousSource !== Source)
            throw new Error('lockstep source changed; reconnect the match');
        Session.Sources.set(Index, Source);
        this.ApplyPendingDrops(Key, Session);
        if (Session.RetiredSlots.has(Index) || Session.DroppedSlots.has(Index)) return [];
        if (Delivery.FrameIndex >= Session.Next + History) {
            const Waiting = Session.Pending.get(Session.Next);
            const Missing = Session.Counts.flatMap((Count, I) =>
                Count && !Session.RetiredSlots.has(I) && !Waiting?.has(I) ? [I] : [],
            );
            throw new Error(
                `lockstep input exceeds paced queue window: input=${Delivery.FrameIndex}, next=${Session.Next}, ` +
                `source=${Index}, effective buffer=${Source.Lockstep.Delay}, window=${History}, ` +
                `queued=${Session.Pending.size}, missing machines=[${Missing.join(',')}]`,
            );
        }
        let Frame = Session.Pending.get(Delivery.FrameIndex);
        if (!Frame) Session.Pending.set(Delivery.FrameIndex, (Frame = new Map()));
        if (!Frame.has(Index)) Frame.set(Index, { ...Delivery, Type: Type });
        return [];
    }

    Prune(Clients) {
        const Live = new Set(Clients);
        const LiveSessions = new Set();
        for (const Client of Live) LiveSessions.add(Client.SessionKey);
        for (const [Key, Session] of this.Sessions) {
            if (!LiveSessions.has(Key)) {
                this.Sessions.delete(Key);
                this.PendingDrops.delete(Key);
                continue;
            }
            for (const [Index, Source] of Session.Sources) {
                if (!Live.has(Source)) this.MarkDroppedSlot(Session, Index);
            }
        }
    }

    Drain(Now, Clients) {
        const Live = new Set(Clients),
            Output = [];
        this.Prune(Live);
        const Rooms = new Map();
        for (const Client of Live) {
            if (!Rooms.has(Client.SessionKey)) Rooms.set(Client.SessionKey, []);
            Rooms.get(Client.SessionKey).push(Client);
        }
        for (const [Key, Session] of this.Sessions) {
            this.ApplyPendingDrops(Key, Session);
            const Room = Rooms.get(Key) || [];
            if (!Room.length) continue;
            if (Session.SummaryAt === null) Session.SummaryAt = Now;
            const Period = 1000 / Session.Rate;
            for (let Released = 0; Released < MaxCatchupTicks; Released++) {
                if (Session.Deadline !== null && Now + 0.000001 < Session.Deadline) break;
                const ActiveSlots = Session.Counts.flatMap((Count, Index) =>
                    Count && !Session.RetiredSlots.has(Index) ? [Index] : [],
                );
                if (!ActiveSlots.length) break;
                const Frame = Session.Pending.get(Session.Next);
                const HasLiveEntry = (Index) => {
                    const Entry = Frame?.get(Index);
                    return Boolean(Entry && Live.has(Entry.Source) && !Session.DroppedSlots.has(Index));
                };
                const FirstLiveSlot = ActiveSlots.find(HasLiveEntry);
                if (FirstLiveSlot === undefined) break;
                for (const Index of Session.StallingSlots) {
                    if (HasLiveEntry(Index)) Session.StallingSlots.delete(Index);
                }
                const MissingLive = ActiveSlots.filter(
                    (Index) =>
                        !Session.DroppedSlots.has(Index) && !Session.StallingSlots.has(Index) && !HasLiveEntry(Index),
                );
                if (MissingLive.length) {
                    if (Session.WaitFrame !== Session.Next) {
                        Session.WaitFrame = Session.Next;
                        Session.WaitSince = Now;
                    }
                    if (Now - Session.WaitSince < StallMs) break;
                    for (const Index of MissingLive) Session.StallingSlots.add(Index);
                }
                // Preserve phase across late pumps; cap time debt after a long pause to this batch.
                // Only wall-clock debt is bounded: every input frame is still released in order.
                const TickAt = Session.Deadline === null
                    ? Now
                    : Math.max(Session.Deadline, Now - Period * (MaxCatchupTicks - 1));
                const RefEntry = Frame.get(FirstLiveSlot);
                const RefToggle = RefEntry.Payload[18] & 0x80;
                const RefChecksum = RefEntry.Payload[20];
                const Wire = Session.Next & 0xff;
                const Deliveries = new Map();
                const Append = (Recipient, PacketType, Packet) => {
                    if (!Live.has(Recipient)) return;
                    let Types = Deliveries.get(Recipient);
                    if (!Types) Deliveries.set(Recipient, (Types = new Map()));
                    if (!Types.has(PacketType)) Types.set(PacketType, []);
                    Types.get(PacketType).push(Packet);
                };
                for (const Index of ActiveSlots) {
                    if (HasLiveEntry(Index)) {
                        Session.FakeCounts[Index] = 0;
                        const Entry = Frame.get(Index);
                        const Recipients =
                            Entry.Routing === undefined
                                ? Entry.Recipients
                                : Room.filter(
                                      (C) =>
                                          Entry.Routing === 3 ||
                                          (Entry.Routing === 2 && C !== Entry.Source) ||
                                          (Entry.Routing === 1 && Entry.Selected?.has(C.MachineId)),
                                  );
                        for (const Recipient of Recipients) Append(Recipient, Entry.Type, Entry.Payload);
                    } else {
                        const Body = BuildFakeBody(Index, Wire, Session.Counts[Index], RefToggle, RefChecksum);
                        let SlotHistory = Session.FakeHistory.get(Index);
                        if (!SlotHistory) Session.FakeHistory.set(Index, (SlotHistory = new Map()));
                        SlotHistory.set(Wire, { Absolute: Session.Next, Body: Body });
                        for (const [OldWire, Cached] of SlotHistory) {
                            if (Cached.Absolute <= Session.Next - History) SlotHistory.delete(OldWire);
                        }
                        while (SlotHistory.size > History) SlotHistory.delete(SlotHistory.keys().next().value);
                        for (const Recipient of Room) {
                            Append(Recipient, RefEntry.Type, BuildFrame(Input, Recipient.MachineId, Body));
                        }
                        Session.FakeCounts[Index] = (Session.FakeCounts[Index] || 0) + 1;
                        if (Session.FakeCounts[Index] >= FakeFramesToRetire) {
                            Session.RetiredSlots.add(Index);
                            Session.DroppedSlots.delete(Index);
                            Session.StallingSlots.delete(Index);
                            Log.Info(
                                `lockstep clock ${Session.Id}: machine slot ${Index} handed over to native AI ` +
                                    `after ${Session.FakeCounts[Index]} faked frames at tick ${Session.Next}`,
                            );
                        }
                    }
                }
                for (const [Recipient, Types] of Deliveries) {
                    for (const [Type, Packets] of Types) {
                        Output.push({ Payload: Buffer.concat(Packets), Recipients: [Recipient], Type: Type });
                    }
                }
                Session.Pending.delete(Session.Next++);
                Session.WaitFrame = null;
                Session.WaitSince = null;
                this.Released++;
                Session.Released++;
                Session.Deadline = TickAt + Period;
            }
        }
        return Output;
    }

    Summary(Now = Perf.now(), Clients) {
        const Frames = this.Released;
        this.Released = 0;
        if (!this.Sessions.size && !Frames) return null;
        const Live = Clients === undefined ? null : new Set(Clients);
        const Rates = [...new Set([...this.Sessions.values()].map((S) => S.Rate))].join('/');
        const Queued = [...this.Sessions.values()].reduce((Sum, S) => Sum + S.Pending.size, 0);
        const Lines = [
            `lockstep clock: ${Frames} complete ticks released, ${this.Sessions.size} match clock(s), target ${Rates || '-'} Hz, ${Queued} ticks queued`,
        ];
        for (const Session of this.Sessions.values()) {
            const Elapsed = Session.SummaryAt === null ? 0 : Math.max(0, Now - Session.SummaryAt);
            const Actual = Elapsed > 0 ? `${(1000 * Session.Released / Elapsed).toFixed(2)} Hz` : 'n/a';
            const Frame = Session.Pending.get(Session.Next);
            const Missing = Session.Counts.flatMap((Count, Index) => {
                if (!Count || Session.RetiredSlots.has(Index) || Session.DroppedSlots.has(Index)) return [];
                const Entry = Frame?.get(Index);
                return Entry && (!Live || Live.has(Entry.Source)) ? [] : [Index];
            });
            const Lag = Session.Deadline === null ? 'unset' : `${(Now - Session.Deadline).toFixed(2)} ms`;
            Lines.push(
                `  clock ${Session.Id}: ${Session.Released} ticks in ${(Elapsed / 1000).toFixed(3)} s, actual=${Actual}, ` +
                    `target=${Session.Rate} Hz, next=${Session.Next}, queued=${Session.Pending.size}, ` +
                    `next ready=${Missing.length ? 'no' : 'yes'}, missing machines=[${Missing.join(',')}], deadline lag=${Lag}`,
            );
            // Only reporting counters are reset; pending input and pacing deadlines are untouched.
            Session.Released = 0;
            Session.SummaryAt = Now;
        }
        return Lines.join('\n');
    }
}

module.exports = { Pacer, StallMs };
