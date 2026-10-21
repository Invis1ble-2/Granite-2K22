// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { History } = require('./LockstepDelay');
const { performance: Perf } = require('node:perf_hooks');
const MaxCatchupTicks = 4;

class Pacer {
    constructor(Hz = 0) {
        if (!Number.isInteger(Hz) || Hz < 0 || Hz > 240)
            throw new Error('lockstep pacing Hz must be 0 (native) or 1..240');
        this.Hz = Hz;
        this.Sessions = new Map();
        this.Released = 0;
        this.NextClockId = 1;
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
        const Index = Source.Lockstep.Index;
        const PreviousSource = Session.Sources.get(Index);
        if (PreviousSource && PreviousSource !== Source)
            throw new Error('lockstep source changed; reconnect the match');
        Session.Sources.set(Index, Source);
        if (Delivery.FrameIndex < Session.Next) {
            return Delivery.Retransmit ? [{ ...Delivery, Type: Type }] : [];
        }
        if (Delivery.Retransmit) return [];
        if (Delivery.FrameIndex >= Session.Next + History) {
            const Waiting = Session.Pending.get(Session.Next);
            const Missing = Session.Counts.flatMap((Count, I) => Count && !Waiting?.has(I) ? [I] : []);
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
        for (const [Key, Session] of this.Sessions) {
            if ([...Session.Sources.values()].some((Source) => !Live.has(Source))) this.Sessions.delete(Key);
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
        for (const Session of this.Sessions.values()) {
            if (Session.SummaryAt === null) Session.SummaryAt = Now;
            const Period = 1000 / Session.Rate;
            const Required = Session.Counts.flatMap((Count, Index) => (Count ? [Index] : []));
            for (let Released = 0; Released < MaxCatchupTicks; Released++) {
                if (Session.Deadline !== null && Now + 0.000001 < Session.Deadline) break;
                const Frame = Session.Pending.get(Session.Next);
                if (!Frame || !Required.every((Index) => Frame.has(Index) && Live.has(Frame.get(Index).Source))) break;
                // Preserve phase across late pumps; cap time debt after a long pause to this batch.
                // Only wall-clock debt is bounded: every input frame is still released in order.
                const TickAt = Session.Deadline === null
                    ? Now
                    : Math.max(Session.Deadline, Now - Period * (MaxCatchupTicks - 1));
                const Deliveries = new Map();
                for (const Index of Required) {
                    const Entry = Frame.get(Index);
                    const Recipients =
                        Entry.Routing === undefined
                            ? Entry.Recipients
                            : (Rooms.get(Entry.Source.SessionKey) || []).filter(
                                  (C) =>
                                      Entry.Routing === 3 ||
                                      (Entry.Routing === 2 && C !== Entry.Source) ||
                                      (Entry.Routing === 1 && Entry.Selected?.has(C.MachineId)),
                              );
                    for (const Recipient of Recipients) {
                        if (!Live.has(Recipient)) continue;
                        let Types = Deliveries.get(Recipient);
                        if (!Types) Deliveries.set(Recipient, (Types = new Map()));
                        if (!Types.has(Entry.Type)) Types.set(Entry.Type, []);
                        Types.get(Entry.Type).push(Entry.Payload);
                    }
                }
                for (const [Recipient, Types] of Deliveries) {
                    for (const [Type, Packets] of Types) {
                        Output.push({ Payload: Buffer.concat(Packets), Recipients: [Recipient], Type: Type });
                    }
                }
                Session.Pending.delete(Session.Next++);
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
                if (!Count) return [];
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

module.exports = { Pacer };
