#!/usr/bin/env python3

import sys
from pathlib import Path

import mido


# ============================================================
# MIDI -> OSCMID
# ============================================================

def get_bpm(mid):
    """
    Get the first tempo found in the MIDI.
    Defaults to 120 BPM.
    """

    for track in mid.tracks:
        for message in track:
            if message.type == "set_tempo":
                return mido.tempo2bpm(message.tempo)

    return 120.0


def collect_notes(mid):
    """
    Collect MIDI notes using absolute ticks.

    MIDI channel 9 is the standard percussion channel.
    """

    events = {}

    for track in mid.tracks:

        current_tick = 0
        active_notes = {}

        for message in track:

            current_tick += message.time

            if not hasattr(message, "channel"):
                continue

            channel = message.channel

            # ------------------------------------------------
            # NOTE ON
            # ------------------------------------------------

            if (
                message.type == "note_on"
                and message.velocity > 0
            ):

                key = (channel, message.note)

                active_notes[key] = current_tick

            # ------------------------------------------------
            # NOTE OFF
            # ------------------------------------------------

            elif (
                message.type == "note_off"
                or (
                    message.type == "note_on"
                    and message.velocity == 0
                )
            ):

                key = (channel, message.note)

                if key in active_notes:

                    start_tick = active_notes.pop(key)

                    events.setdefault(
                        channel,
                        []
                    ).append(
                        (
                            start_tick,
                            current_tick,
                            message.note
                        )
                    )

    return events


# ============================================================
# TIMING
# ============================================================

def ticks_to_units(
    ticks,
    ticks_per_beat
):
    """
    OSCMID currently uses one unit as one sixteenth note.

    One MIDI quarter note = 4 OSCMID units.
    """

    return (
        ticks /
        (ticks_per_beat / 4)
    )


def quantize(value):
    return max(
        0,
        int(round(value))
    )


# ============================================================
# MAKE NOTE STREAM
# ============================================================

def make_note_stream(
    note_events,
    ticks_per_beat
):

    if not note_events:
        return []


    last_tick = max(
        end
        for start, end, note
        in note_events
    )


    length = max(
        1,
        quantize(
            ticks_to_units(
                last_tick,
                ticks_per_beat
            )
        )
    )


    stream = [0] * length


    for start, end, note in sorted(
        note_events,
        key=lambda event: (
            event[0],
            event[1],
            event[2]
        )
    ):

        start_unit = quantize(
            ticks_to_units(
                start,
                ticks_per_beat
            )
        )


        end_unit = quantize(
            ticks_to_units(
                end,
                ticks_per_beat
            )
        )


        if end_unit <= start_unit:
            end_unit = start_unit + 1


        end_unit = min(
            end_unit,
            length
        )


        # IMPORTANT:
        # The MIDI note number is copied directly.
        #
        # MIDI 57 -> OSCMID 57
        # MIDI 60 -> OSCMID 60
        # MIDI 69 -> OSCMID 69
        #
        # NO +8
        # NO -8
        # NO transposition.

        for unit in range(
            start_unit,
            end_unit
        ):

            if stream[unit] == 0:
                stream[unit] = note


    return stream


# ============================================================
# STREAM -> OSCMID TEXT
# ============================================================

def stream_to_text(stream):

    if not stream:
        return ""


    output = []


    for i, note in enumerate(stream):

        if note == 0:

            output.append(
                "0,"
            )

            continue


        if i == 0:

            output.append(
                f"{note},"
            )

            continue


        previous = stream[i - 1]


        if previous == note:

            # No space = held.
            output.append(
                f"{note},"
            )

        else:

            # Space = retrigger.
            output.append(
                f" {note},"
            )


    return "".join(output)


# ============================================================
# MIDI PROGRAMS
# ============================================================

def get_programs(mid):

    programs = {}


    for track in mid.tracks:

        for message in track:

            if (
                message.type ==
                "program_change"
                and
                message.channel != 9
            ):

                programs.setdefault(
                    message.channel,
                    message.program
                )


    return programs


# ============================================================
# BUILD OSCMID
# ============================================================

def convert_midi(
    input_file,
    output_file
):

    mid = mido.MidiFile(
        input_file
    )


    bpm = get_bpm(mid)

    events = collect_notes(mid)

    programs = get_programs(mid)


    melodic_channels = sorted(
        channel
        for channel in events
        if channel != 9
    )


    has_percussion = (
        9 in events
        and
        bool(events[9])
    )


    lines = []


    # ========================================================
    # HEADER
    # ========================================================

    lines.append("OM")
    lines.append("")


    # ========================================================
    # CHANNELS
    # ========================================================

    lines.append(
        "channelsstart"
    )

    lines.append(
        "++ Generated from a standard MIDI file."
    )

    lines.append(
        "++ MIDI note numbers are preserved exactly."
    )

    lines.append("")


    for channel in melodic_channels:

        instrument = programs.get(
            channel,
            0
        )


        lines.append(
            f"{channel} = {instrument}"
        )


        # Triangle-wave property.
        if instrument == 1:

            lines.append(
                'bent: "false"'
            )


        lines.append("")


    if has_percussion:

        lines.append(
            "9 = 9"
        )

        lines.append(
            'noise: "true"'
        )

        lines.append(
            'PCMdrums: "false"'
        )

        lines.append("")


    lines.append(
        "channelsend"
    )

    lines.append("")


    # ========================================================
    # NOTES
    # ========================================================

    lines.append(
        "notesstart"
    )

    lines.append(
        "++ One number is one MIDI unit."
    )

    lines.append(
        "++ No space between equal notes means held."
    )

    lines.append(
        "++ A space means the note is repeated."
    )

    lines.append(
        "++ 0 means empty space."
    )

    lines.append("")


    # --------------------------------------------------------
    # MELODIC STREAMS
    # --------------------------------------------------------

    for channel in melodic_channels:

        stream = make_note_stream(
            events[channel],
            mid.ticks_per_beat
        )


        lines.append(
            f"{channel}: "
            f"{stream_to_text(stream)}"
        )


    # --------------------------------------------------------
    # PERCUSSION
    # --------------------------------------------------------

    if has_percussion:

        stream = make_note_stream(
            events[9],
            mid.ticks_per_beat
        )


        lines.append(
            "percussion: "
            f"{stream_to_text(stream)}"
        )


    lines.append("")
    lines.append(
        "notesend"
    )

    lines.append("")


    # ========================================================
    # METADATA
    # ========================================================

    lines.append(
        "metadatastart"
    )


    lines.append(
        f'BPM: "{bpm:.6f}"'
    )


    melodic_list = ", ".join(
        str(channel)
        for channel in melodic_channels
    )


    if melodic_list:
        melodic_list += ","


    lines.append(
        f'melodic: "{melodic_list}"'
    )


    if has_percussion:

        percussion_notes = sorted(
            {
                note
                for start, end, note
                in events[9]
            }
        )


        percussion_list = ", ".join(
            str(note)
            for note in percussion_notes
        )


        if percussion_list:
            percussion_list += ","


        lines.append(
            f'percussion: "{percussion_list}"'
        )

    else:

        lines.append(
            'percussion: ""'
        )


    lines.append(
        "metadataend"
    )

    lines.append("")


    # ========================================================
    # CONVERTER
    # ========================================================

    lines.append(
        "converterstart"
    )

    lines.append(
        "++ Converts note streams into OSCMID channels."
    )

    lines.append(
        "++ This does not cover percussion."
    )

    lines.append("")


    for channel in melodic_channels:

        lines.append(
            f"{channel} = {channel}"
        )


    lines.append("")

    lines.append(
        "converterend"
    )

    lines.append("")


    # ========================================================
    # END
    # ========================================================

    lines.append(
        "end"
    )


    Path(
        output_file
    ).write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8"
    )


# ============================================================
# COMMAND LINE
# ============================================================

def main():

    if len(sys.argv) < 2:

        print(
            "Usage:"
        )

        print(
            "  python midi_to_oscmid.py input.mid [output.oscmid]"
        )

        return


    input_file = Path(
        sys.argv[1]
    )


    if not input_file.exists():

        print(
            f"Error: {input_file} does not exist."
        )

        return


    if len(sys.argv) >= 3:

        output_file = Path(
            sys.argv[2]
        )

    else:

        output_file = (
            input_file.with_suffix(
                ".oscmid"
            )
        )


    try:

        convert_midi(
            input_file,
            output_file
        )

    except Exception as error:

        print(
            f"Conversion failed: {error}"
        )

        raise


    print(
        f"Converted {input_file}"
    )

    print(
        f"      -> {output_file}"
    )


if __name__ == "__main__":
    main()