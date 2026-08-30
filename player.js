const fileInput = document.getElementById("fileInput");
const playButton = document.getElementById("playButton");
const stopButton = document.getElementById("stopButton");

const fileInfo = document.getElementById("fileInfo");
const channelsDisplay = document.getElementById("channels");
const status = document.getElementById("status");

let audioContext = null;
let activeNodes = [];
let playbackId = 0;
let song = null;


// ============================================================
// INSTRUMENT NAMES
// ============================================================

const instrumentNames = [
    "Square",
    "Triangle",
    "Sampled",
    "DPCM",
    "Sawtooth",
    "Sine",
    "XM",
    "AM",
    "FM",
    "Noise / PCM drums"
];


// ============================================================
// FILE INPUT
// ============================================================

fileInput.addEventListener("change", async () => {

    const file = fileInput.files[0];

    if (!file) {
        return;
    }

    try {

        const text = await file.text();

        song = parseOSCMID(text);

        fileInfo.textContent =
            `Name: ${file.name}\n` +
            `Size: ${file.size} bytes\n` +
            `BPM: ${song.metadata.BPM}`;

        displayChannels(song);

        status.textContent =
            "OSCMID file loaded.";

    }
    catch (error) {

        song = null;

        fileInfo.textContent =
            "Failed to load file.";

        channelsDisplay.textContent =
            "No channels loaded.";

        status.textContent =
            `Error: ${error.message}`;

        console.error(error);
    }
});


// ============================================================
// PARSER
// ============================================================

function parseOSCMID(source) {

    source = source.replace(/^\uFEFF/, "");

    const rawLines =
        source.split(/\r?\n/);

    const lines =
        rawLines
            .map(line => {

                const comment =
                    line.indexOf("++");

                if (comment !== -1) {
                    line =
                        line.substring(0, comment);
                }

                return line.trim();
            })
            .filter(line => line.length > 0);


    if (lines.length === 0) {
        throw new Error("Empty OSCMID file.");
    }


    if (lines[0] !== "OM") {
        throw new Error("Missing OM header.");
    }


    const channels = {};
    const notes = {};
    const metadata = {};
    const converter = {};

    let section = null;
    let currentChannel = null;


    for (let i = 1; i < lines.length; i++) {

        const line = lines[i];


        // ----------------------------------------------------
        // SECTION MARKERS
        // ----------------------------------------------------

        if (line === "channelsstart") {
            section = "channels";
            currentChannel = null;
            continue;
        }

        if (line === "channelsend") {
            section = null;
            currentChannel = null;
            continue;
        }

        if (line === "notesstart") {
            section = "notes";
            continue;
        }

        if (line === "notesend") {
            section = null;
            continue;
        }

        if (line === "metadatastart") {
            section = "metadata";
            continue;
        }

        if (line === "metadataend") {
            section = null;
            continue;
        }

        if (line === "converterstart") {
            section = "converter";
            continue;
        }

        if (line === "converterend") {
            section = null;
            continue;
        }

        if (line === "end") {
            break;
        }


        // ----------------------------------------------------
        // CHANNELS
        // ----------------------------------------------------

        if (section === "channels") {

            const channelMatch =
                line.match(
                    /^(\d+)\s*=\s*(-?\d+)$/
                );


            if (channelMatch) {

                const channel =
                    Number(channelMatch[1]);

                const instrument =
                    Number(channelMatch[2]);


                channels[channel] = {
                    instrument,
                    properties: {}
                };


                currentChannel =
                    channel;

                continue;
            }


            const propertyMatch =
                line.match(
                    /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]*)"$/
                );


            if (
                propertyMatch &&
                currentChannel !== null
            ) {

                channels[currentChannel]
                    .properties[propertyMatch[1]] =
                    parseValue(propertyMatch[2]);
            }

            continue;
        }


        // ----------------------------------------------------
        // NOTES
        // ----------------------------------------------------

        if (section === "notes") {

            const noteMatch =
                line.match(
                    /^([A-Za-z_][A-Za-z0-9_]*|\d+)\s*:(.*)$/
                );


            if (!noteMatch) {
                continue;
            }


            notes[noteMatch[1]] =
                parseNoteSequence(
                    noteMatch[2]
                );

            continue;
        }


        // ----------------------------------------------------
        // METADATA
        // ----------------------------------------------------

        if (section === "metadata") {

            const metadataMatch =
                line.match(
                    /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]*)"$/
                );


            if (!metadataMatch) {
                continue;
            }


            metadata[metadataMatch[1]] =
                parseMetadataValue(
                    metadataMatch[2]
                );

            continue;
        }


        // ----------------------------------------------------
        // CONVERTER
        // ----------------------------------------------------

        if (section === "converter") {

            const converterMatch =
                line.match(
                    /^(\d+)\s*=\s*(\d+)$/
                );


            if (!converterMatch) {
                continue;
            }


            /*
             * IMPORTANT:
             *
             * OSCMID converter:
             *
             *     0 = 30
             *
             * means:
             *
             *     OSCMID channel 0
             *     uses notes channel 30
             *
             * Therefore converter[0] = 30.
             */

            converter[
                Number(converterMatch[1])
            ] =
                Number(converterMatch[2]);

            continue;
        }
    }


    const bpm =
        Number(metadata.BPM);


    if (
        !Number.isFinite(bpm) ||
        bpm <= 0
    ) {
        throw new Error(
            "Invalid or missing BPM."
        );
    }


    return {
        channels,
        notes,
        metadata,
        converter
    };
}


// ============================================================
// VALUE PARSER
// ============================================================

function parseValue(value) {

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }


    const number =
        Number(value);


    if (Number.isFinite(number)) {
        return number;
    }


    return value;
}


// ============================================================
// METADATA PARSER
// ============================================================

function parseMetadataValue(value) {

    if (value.includes(",")) {

        return value
            .split(",")
            .map(x => x.trim())
            .filter(Boolean)
            .map(x => {

                const n =
                    Number(x);

                return Number.isFinite(n)
                    ? n
                    : x;
            });
    }


    return parseValue(value);
}


// ============================================================
// NOTE PARSER
// ============================================================

function parseNoteSequence(text) {

    const sequence = [];

    let position = 0;


    while (position < text.length) {

        while (
            position < text.length &&
            /\s/.test(text[position])
        ) {
            position++;
        }


        if (position >= text.length) {
            break;
        }


        const match =
            text
                .substring(position)
                .match(
                    /^-?\d+(?:\.\d+)?/
                );


        if (!match) {

            throw new Error(
                `Invalid note near: ${
                    text.substring(position)
                }`
            );
        }


        const value =
            Number(match[0]);


        position +=
            match[0].length;


        if (text[position] === ",") {
            position++;
        }


        /*
         * A note immediately followed by another
         * note is held.
         *
         * A space means the next note is repeated.
         */

        let repeated = false;


        if (
            position < text.length &&
            /\s/.test(text[position])
        ) {
            repeated = true;
        }


        sequence.push({
            value,
            repeated
        });
    }


    return sequence;
}


// ============================================================
// CHANNEL DISPLAY
// ============================================================

function displayChannels(song) {

    const channelNumbers =
        Object.keys(song.channels)
            .map(Number)
            .sort((a, b) => a - b);


    if (channelNumbers.length === 0) {

        channelsDisplay.textContent =
            "No channels loaded.";

        return;
    }


    const output = [];


    for (const channelNumber of channelNumbers) {

        const channel =
            song.channels[channelNumber];


        const name =
            instrumentNames[channel.instrument] ||
            "Unknown";


        output.push(
            `Channel ${channelNumber}: ` +
            `${name} (${channel.instrument})`
        );


        for (
            const property in channel.properties
        ) {

            output.push(
                `  ${property}: ` +
                JSON.stringify(
                    channel.properties[property]
                )
            );
        }


        output.push("");
    }


    channelsDisplay.textContent =
        output.join("\n");
}


// ============================================================
// PLAY BUTTON
// ============================================================

playButton.addEventListener(
    "click",
    async () => {

        if (!song) {

            status.textContent =
                "Load an OSCMID file first.";

            return;
        }


        stopPlayback();


        if (!audioContext) {

            audioContext =
                new AudioContext();
        }


        await audioContext.resume();


        playbackId++;


        const id =
            playbackId;


        status.textContent =
            `Playing — ${song.metadata.BPM} BPM`;


        playSong(
            song,
            id
        );
    }
);


// ============================================================
// STOP BUTTON
// ============================================================

stopButton.addEventListener(
    "click",
    () => {

        stopPlayback();


        status.textContent =
            song
                ? "Stopped."
                : "Waiting for OSCMID file...";
    }
);


// ============================================================
// PLAY SONG
// ============================================================

function playSong(song, id) {

    const bpm =
        Number(song.metadata.BPM);


    /*
     * One OSCMID note unit = one quarter-note subdivision.
     *
     * The note streams you supplied use 4 units per beat.
     */

    const unitDuration =
        60 / bpm / 4;


    const startTime =
        audioContext.currentTime + 0.05;


    let longest =
        0;


    // --------------------------------------------------------
    // MELODIC CHANNELS
    // --------------------------------------------------------

    for (
        const streamName in song.notes
    ) {

        if (
            streamName === "percussion"
        ) {
            continue;
        }


        const streamID =
            Number(streamName);


        if (!Number.isFinite(streamID)) {
            continue;
        }


        /*
         * THIS IS THE IMPORTANT FIX.
         *
         * Converter:
         *
         *     0 = 30
         *     1 = 8
         *
         * means:
         *
         *     note stream 30 → channel 0
         *     note stream 8  → channel 1
         *
         * So we search for the OSCMID channel whose
         * converter value equals this note stream.
         */

        const channelNumber =
            findChannelForNoteStream(
                song.converter,
                streamID
            );


        if (
            channelNumber === null
        ) {
            continue;
        }


        const channel =
            song.channels[channelNumber];


        if (!channel) {
            continue;
        }


        const sequence =
            song.notes[streamName];


        longest =
            Math.max(
                longest,
                sequence.length
            );


        playMelodicSequence(
            sequence,
            channel,
            startTime,
            unitDuration,
            id
        );
    }


    // --------------------------------------------------------
    // PERCUSSION
    // --------------------------------------------------------

    if (song.notes.percussion) {

        longest =
            Math.max(
                longest,
                song.notes.percussion.length
            );


        const percussionChannel =
            song.channels[9] || {
                instrument: 9,
                properties: {
                    noise: true,
                    PCMdrums: false
                }
            };


        playPercussionSequence(
            song.notes.percussion,
            percussionChannel,
            startTime,
            unitDuration,
            id
        );
    }


    setTimeout(
        () => {

            if (id === playbackId) {

                status.textContent =
                    "Finished.";
            }

        },
        (
            longest * unitDuration +
            0.8
        ) * 1000
    );
}


// ============================================================
// CONVERTER LOOKUP
// ============================================================

function findChannelForNoteStream(
    converter,
    streamID
) {

    for (
        const channelNumber in converter
    ) {

        if (
            converter[channelNumber] ===
            streamID
        ) {

            return Number(
                channelNumber
            );
        }
    }


    return null;
}


// ============================================================
// MELODIC SEQUENCE
// ============================================================

function playMelodicSequence(
    sequence,
    channel,
    startTime,
    unitDuration,
    id
) {

    let i = 0;


    while (
        i < sequence.length
    ) {

        if (
            id !== playbackId
        ) {
            return;
        }


        const event =
            sequence[i];


        if (
            event.value === 0
        ) {

            i++;
            continue;
        }


        /*
         * Consecutive identical notes with no space
         * between them are one held note.
         */

        let length = 1;


        while (
            i + length <
            sequence.length &&

            sequence[i + length].value ===
            event.value &&

            !sequence[i + length].repeated
        ) {

            length++;
        }


        const time =
            startTime +
            i * unitDuration;


        const duration =
            length *
            unitDuration;


        playInstrument(
            channel,
            event.value,
            time,
            duration
        );


        i += length;
    }
}


// ============================================================
// INSTRUMENT DISPATCH
// ============================================================

function playInstrument(
    channel,
    midiNote,
    time,
    duration
) {

    switch (
        channel.instrument
    ) {

        case 0:
            playSquare(
                midiNote,
                time,
                duration,
                channel.properties
            );
            break;


        case 1:
            playNESTriangle(
                midiNote,
                time,
                duration
            );
            break;


        case 2:
            playSampled(
                midiNote,
                time,
                duration
            );
            break;


        case 3:
            playDPCM(
                midiNote,
                time,
                duration
            );
            break;


        case 4:
            playOscillator(
                "sawtooth",
                midiNote,
                time,
                duration
            );
            break;


        case 5:
            playOscillator(
                "sine",
                midiNote,
                time,
                duration
            );
            break;


        case 6:
            playXM(
                midiNote,
                time,
                duration
            );
            break;


        case 7:
            playAM(
                midiNote,
                time,
                duration
            );
            break;


        case 8:
            playFM(
                midiNote,
                time,
                duration
            );
            break;


        case 9:
            playNoise(
                midiNote,
                time,
                duration,
                channel.properties
            );
            break;


        default:
            playOscillator(
                "sine",
                midiNote,
                time,
                duration
            );
    }
}


// ============================================================
// MIDI FREQUENCY
// ============================================================

function midiToFrequency(note) {

    /*
     * Standard MIDI note numbering.
     *
     * NO +8 correction.
     */

    return 440 *
        Math.pow(
            2,
            (note - 69) / 12
        );
}


// ============================================================
// BASIC OSCILLATOR
// ============================================================

function playOscillator(
    type,
    midiNote,
    time,
    duration
) {

    const oscillator =
        audioContext.createOscillator();


    const gain =
        audioContext.createGain();


    oscillator.type =
        type;


    oscillator.frequency.setValueAtTime(
        midiToFrequency(midiNote),
        time
    );


    envelope(
        gain,
        time,
        duration,
        0.18
    );


    oscillator.connect(gain);
    gain.connect(
        audioContext.destination
    );


    oscillator.start(time);

    oscillator.stop(
        time +
        duration +
        0.02
    );


    activeNodes.push(
        oscillator
    );
}


// ============================================================
// SQUARE
// ============================================================

function playSquare(
    midiNote,
    time,
    duration,
    properties
) {

    const duty =
        Number(
            properties.dutycycle ??
            properties.duty ??
            50
        );


    const dutyRatio =
        Math.max(
            0.01,
            Math.min(
                0.99,
                duty / 100
            )
        );


    const oscillator =
        audioContext.createOscillator();


    const gain =
        audioContext.createGain();


    oscillator.setPeriodicWave(
        makePulseWave(
            dutyRatio
        )
    );


    oscillator.frequency.setValueAtTime(
        midiToFrequency(midiNote),
        time
    );


    envelope(
        gain,
        time,
        duration,
        0.18
    );


    oscillator.connect(gain);
    gain.connect(
        audioContext.destination
    );


    oscillator.start(time);

    oscillator.stop(
        time +
        duration +
        0.02
    );


    activeNodes.push(
        oscillator
    );
}


// ============================================================
// PULSE WAVE
// ============================================================

function makePulseWave(
    duty
) {

    const real =
        new Float32Array(64);

    const imag =
        new Float32Array(64);


    for (
        let harmonic = 1;
        harmonic < 64;
        harmonic++
    ) {

        imag[harmonic] =
            Math.sin(
                Math.PI *
                harmonic *
                duty
            ) /
            (
                Math.PI *
                harmonic
            );
    }


    return audioContext.createPeriodicWave(
        real,
        imag
    );
}


// ============================================================
// NES TRIANGLE
// ============================================================

function playNESTriangle(
    midiNote,
    time,
    duration
) {

    const frequency =
        midiToFrequency(
            midiNote
        );


    const sampleRate =
        audioContext.sampleRate;


    const sampleCount =
        Math.max(
            1,
            Math.ceil(
                duration *
                sampleRate
            )
        );


    const buffer =
        audioContext.createBuffer(
            1,
            sampleCount,
            sampleRate
        );


    const data =
        buffer.getChannelData(0);


    const steps = [
        0, 1, 2, 3,
        4, 5, 6, 7,
        8, 9, 10, 11,
        12, 13, 14, 15,
        15, 14, 13, 12,
        11, 10, 9, 8,
        7, 6, 5, 4,
        3, 2, 1, 0
    ];


    for (
        let i = 0;
        i < sampleCount;
        i++
    ) {

        const phase =
            (
                i /
                sampleRate *
                frequency
            ) % 1;


        const step =
            steps[
                Math.floor(
                    phase *
                    steps.length
                )
            ];


        data[i] =
            step / 7.5 - 1;
    }


    const source =
        audioContext.createBufferSource();


    const gain =
        audioContext.createGain();


    source.buffer =
        buffer;


    envelope(
        gain,
        time,
        duration,
        0.18
    );


    source.connect(gain);
    gain.connect(
        audioContext.destination
    );


    source.start(time);

    source.stop(
        time +
        duration +
        0.02
    );


    activeNodes.push(
        source
    );
}


// ============================================================
// SAMPLED
// ============================================================

function playSampled(
    midiNote,
    time,
    duration
) {

    const frequency =
        midiToFrequency(
            midiNote
        );


    const sampleRate =
        audioContext.sampleRate;


    const actualDuration =
        Math.min(
            duration,
            0.25
        );


    const length =
        Math.max(
            1,
            Math.floor(
                sampleRate *
                actualDuration
            )
        );


    const buffer =
        audioContext.createBuffer(
            1,
            length,
            sampleRate
        );


    const data =
        buffer.getChannelData(0);


    const sampleRateDivider =
        16;


    let heldSample = 0;


    for (
        let i = 0;
        i < length;
        i++
    ) {

        if (
            i %
            sampleRateDivider ===
            0
        ) {

            const phase =
                (
                    i /
                    sampleRate *
                    frequency
                ) % 1;


            heldSample =
                Math.round(
                    (
                        2 * phase - 1
                    ) * 16
                ) / 16;
        }


        const decay =
            Math.pow(
                1 -
                i / length,
                0.7
            );


        data[i] =
            heldSample *
            decay;
    }


    const source =
        audioContext.createBufferSource();


    const gain =
        audioContext.createGain();


    source.buffer =
        buffer;


    envelope(
        gain,
        time,
        actualDuration,
        0.15
    );


    source.connect(gain);
    gain.connect(
        audioContext.destination
    );


    source.start(time);

    source.stop(
        time +
        actualDuration +
        0.02
    );


    activeNodes.push(
        source
    );
}


// ============================================================
// DPCM
// ============================================================

function playDPCM(
    midiNote,
    time,
    duration
) {

    const frequency =
        midiToFrequency(
            midiNote
        );


    const sampleRate =
        audioContext.sampleRate;


    const actualDuration =
        Math.min(
            duration,
            0.35
        );


    const length =
        Math.max(
            1,
            Math.floor(
                sampleRate *
                actualDuration
            )
        );


    const buffer =
        audioContext.createBuffer(
            1,
            length,
            sampleRate
        );


    const data =
        buffer.getChannelData(0);


    let accumulator = 0;

    const period =
        sampleRate /
        Math.max(
            1,
            frequency
        );


    let nextStep = 0;


    for (
        let i = 0;
        i < length;
        i++
    ) {

        if (
            i >= nextStep
        ) {

            accumulator =
                accumulator >= 0
                    ? -1
                    : 1;

            nextStep +=
                period;
        }


        data[i] =
            accumulator *
            0.12;
    }


    const source =
        audioContext.createBufferSource();


    const gain =
        audioContext.createGain();


    source.buffer =
        buffer;


    envelope(
        gain,
        time,
        actualDuration,
        0.14
    );


    source.connect(gain);
    gain.connect(
        audioContext.destination
    );


    source.start(time);

    source.stop(
        time +
        actualDuration +
        0.02
    );


    activeNodes.push(
        source
    );
}


// ============================================================
// XM
// ============================================================

function playXM(
    midiNote,
    time,
    duration
) {

    const carrier =
        audioContext.createOscillator();


    const modulator =
        audioContext.createOscillator();


    const modGain =
        audioContext.createGain();


    const output =
        audioContext.createGain();


    const frequency =
        midiToFrequency(
            midiNote
        );


    carrier.type =
        "sine";


    modulator.type =
        "sine";


    carrier.frequency.setValueAtTime(
        frequency,
        time
    );


    modulator.frequency.setValueAtTime(
        4,
        time
    );


    modGain.gain.setValueAtTime(
        frequency * 0.08,
        time
    );


    modulator.connect(
        modGain
    );


    modGain.connect(
        carrier.frequency
    );


    envelope(
        output,
        time,
        duration,
        0.15
    );


    carrier.connect(output);
    output.connect(
        audioContext.destination
    );


    carrier.start(time);
    modulator.start(time);


    carrier.stop(
        time +
        duration +
        0.02
    );


    modulator.stop(
        time +
        duration +
        0.02
    );


    activeNodes.push(
        carrier,
        modulator
    );
}


// ============================================================
// AM
// ============================================================

function playAM(
    midiNote,
    time,
    duration
) {

    const carrier =
        audioContext.createOscillator();


    const modulator =
        audioContext.createOscillator();


    const modGain =
        audioContext.createGain();


    const output =
        audioContext.createGain();


    carrier.type =
        "sine";


    modulator.type =
        "sine";


    carrier.frequency.setValueAtTime(
        midiToFrequency(midiNote),
        time
    );


    modulator.frequency.setValueAtTime(
        7,
        time
    );


    modGain.gain.setValueAtTime(
        0.08,
        time
    );


    modulator.connect(
        modGain
    );


    modGain.connect(
        output.gain
    );


    output.gain.setValueAtTime(
        0.08,
        time
    );


    envelope(
        output,
        time,
        duration,
        0.15
    );


    carrier.connect(output);
    output.connect(
        audioContext.destination
    );


    carrier.start(time);
    modulator.start(time);


    carrier.stop(
        time +
        duration +
        0.02
    );


    modulator.stop(
        time +
        duration +
        0.02
    );


    activeNodes.push(
        carrier,
        modulator
    );
}


// ============================================================
// FM
// ============================================================

function playFM(
    midiNote,
    time,
    duration
) {

    const carrier =
        audioContext.createOscillator();


    const modulator =
        audioContext.createOscillator();


    const modGain =
        audioContext.createGain();


    const output =
        audioContext.createGain();


    const frequency =
        midiToFrequency(
            midiNote
        );


    carrier.type =
        "sine";


    modulator.type =
        "sine";


    carrier.frequency.setValueAtTime(
        frequency,
        time
    );


    modulator.frequency.setValueAtTime(
        frequency * 2,
        time
    );


    modGain.gain.setValueAtTime(
        frequency * 0.5,
        time
    );


    modulator.connect(
        modGain
    );


    modGain.connect(
        carrier.frequency
    );


    envelope(
        output,
        time,
        duration,
        0.15
    );


    carrier.connect(output);
    output.connect(
        audioContext.destination
    );


    carrier.start(time);
    modulator.start(time);


    carrier.stop(
        time +
        duration +
        0.02
    );


    modulator.stop(
        time +
        duration +
        0.02
    );


    activeNodes.push(
        carrier,
        modulator
    );
}


// ============================================================
// NOISE / PCM
// ============================================================

function playNoise(
    midiNote,
    time,
    duration,
    properties
) {

    if (
        properties.PCMdrums === true
    ) {

        playPCMDrum(
            midiNote,
            time,
            duration
        );

        return;
    }


    playNoiseDrum(
        midiNote,
        time,
        duration
    );
}


// ============================================================
// NOISE DRUM
// ============================================================

function playNoiseDrum(
    midiNote,
    time,
    duration
) {

    const actualDuration =
        Math.min(
            duration,
            0.18
        );


    const length =
        Math.floor(
            audioContext.sampleRate *
            actualDuration
        );


    const buffer =
        audioContext.createBuffer(
            1,
            length,
            audioContext.sampleRate
        );


    const data =
        buffer.getChannelData(0);


    for (
        let i = 0;
        i < length;
        i++
    ) {

        const decay =
            Math.pow(
                1 -
                i / length,
                3
            );


        data[i] =
            (
                Math.random() *
                2 - 1
            ) *
            decay;
    }


    const source =
        audioContext.createBufferSource();


    const filter =
        audioContext.createBiquadFilter();


    const gain =
        audioContext.createGain();


    source.buffer =
        buffer;


    filter.type =
        "bandpass";


    filter.frequency.value =
        2500;


    filter.Q.value =
        1.5;


    gain.gain.setValueAtTime(
        0.2,
        time
    );


    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        time +
        actualDuration
    );


    source.connect(filter);
    filter.connect(gain);
    gain.connect(
        audioContext.destination
    );


    source.start(time);

    source.stop(
        time +
        actualDuration
    );


    activeNodes.push(
        source
    );
}


// ============================================================
// PCM DRUMS
// ============================================================

function playPCMDrum(
    midiNote,
    time,
    duration
) {

    const actualDuration =
        getDrumDuration(
            midiNote
        );


    const sampleRate =
        audioContext.sampleRate;


    const length =
        Math.floor(
            sampleRate *
            actualDuration
        );


    const buffer =
        audioContext.createBuffer(
            1,
            length,
            sampleRate
        );


    const data =
        buffer.getChannelData(0);


    for (
        let i = 0;
        i < length;
        i++
    ) {

        const t =
            i / sampleRate;


        const decay =
            Math.exp(
                -t * 25
            );


        let sample;


        if (
            midiNote === 36
        ) {

            const frequency =
                140 *
                Math.exp(
                    -t * 15
                ) +
                45;


            sample =
                Math.sin(
                    2 *
                    Math.PI *
                    frequency *
                    t
                ) *
                decay;
        }

        else if (
            midiNote === 38
        ) {

            sample =
                (
                    Math.random() *
                    2 - 1
                ) *
                Math.exp(
                    -t * 35
                );
        }

        else if (
            midiNote === 42
        ) {

            sample =
                (
                    Math.random() *
                    2 - 1
                ) *
                Math.exp(
                    -t * 70
                );
        }

        else if (
            midiNote === 46
        ) {

            sample =
                (
                    Math.random() *
                    2 - 1
                ) *
                Math.exp(
                    -t * 12
                );
        }

        else {

            sample =
                (
                    Math.random() *
                    2 - 1
                ) *
                Math.exp(
                    -t * 25
                );
        }


        data[i] =
            Math.round(
                sample * 32
            ) / 32;
    }


    const source =
        audioContext.createBufferSource();


    const gain =
        audioContext.createGain();


    source.buffer =
        buffer;


    gain.gain.value =
        0.2;


    source.connect(gain);
    gain.connect(
        audioContext.destination
    );


    source.start(time);

    source.stop(
        time +
        actualDuration
    );


    activeNodes.push(
        source
    );
}


// ============================================================
// DRUM DURATIONS
// ============================================================

function getDrumDuration(
    note
) {

    if (note === 36) {
        return 0.35;
    }

    if (note === 38) {
        return 0.20;
    }

    if (note === 42) {
        return 0.08;
    }

    if (note === 46) {
        return 0.35;
    }


    // Vibraslap
    if (note === 58) {
        return 0.5;
    }


    return 0.15;
}


// ============================================================
// PERCUSSION
// ============================================================

function playPercussionSequence(
    sequence,
    channel,
    startTime,
    unitDuration,
    id
) {

    for (
        let i = 0;
        i < sequence.length;
        i++
    ) {

        if (
            id !== playbackId
        ) {
            return;
        }


        const event =
            sequence[i];


        if (
            event.value === 0
        ) {
            continue;
        }


        const time =
            startTime +
            i * unitDuration;


        // Vibraslap is MIDI 58.
        if (
            event.value === 58
        ) {

            playVibraslap(
                time,
                0.5
            );

            continue;
        }


        if (
            channel.instrument === 9 &&
            channel.properties.PCMdrums === true
        ) {

            playPCMDrum(
                event.value,
                time,
                unitDuration
            );

        }
        else {

            playNoiseDrum(
                event.value,
                time,
                unitDuration
            );
        }
    }
}


// ============================================================
// VIBRASLAP
// ============================================================

function playVibraslap(
    time,
    duration
) {

    const sampleRate =
        audioContext.sampleRate;


    const length =
        Math.floor(
            sampleRate *
            duration
        );


    const buffer =
        audioContext.createBuffer(
            1,
            length,
            sampleRate
        );


    const data =
        buffer.getChannelData(0);


    for (
        let i = 0;
        i < length;
        i++
    ) {

        const t =
            i / sampleRate;


        const decay =
            Math.exp(
                -t * 7
            );


        data[i] =
            (
                Math.random() *
                2 - 1
            ) *
            decay;
    }


    const source =
        audioContext.createBufferSource();


    const filter =
        audioContext.createBiquadFilter();


    const gain =
        audioContext.createGain();


    source.buffer =
        buffer;


    filter.type =
        "bandpass";


    filter.frequency.value =
        2300;


    filter.Q.value =
        3;


    const attack =
        0.005;


    const release =
        0.15;


    gain.gain.setValueAtTime(
        0.0001,
        time
    );


    gain.gain.exponentialRampToValueAtTime(
        0.25,
        time + attack
    );


    gain.gain.setValueAtTime(
        0.25,
        time +
        duration -
        release
    );


    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        time +
        duration
    );


    source.connect(filter);
    filter.connect(gain);
    gain.connect(
        audioContext.destination
    );


    source.start(time);

    source.stop(
        time +
        duration
    );


    activeNodes.push(
        source
    );
}


// ============================================================
// ENVELOPE
// ============================================================

function envelope(
    gain,
    time,
    duration,
    level
) {

    const attack =
        Math.min(
            0.005,
            duration * 0.25
        );


    const release =
        Math.min(
            0.01,
            duration * 0.25
        );


    const releaseStart =
        Math.max(
            time + attack,
            time +
            duration -
            release
        );


    gain.gain.setValueAtTime(
        0.0001,
        time
    );


    gain.gain.exponentialRampToValueAtTime(
        level,
        time + attack
    );


    gain.gain.setValueAtTime(
        level,
        releaseStart
    );


    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        time +
        duration
    );
}


// ============================================================
// STOP PLAYBACK
// ============================================================

function stopPlayback() {

    playbackId++;


    for (
        const node of activeNodes
    ) {

        try {
            node.stop();
        }
        catch {
            // Already stopped.
        }
    }


    activeNodes = [];
}
