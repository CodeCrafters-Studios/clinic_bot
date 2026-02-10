const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const dayjs = require('dayjs');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const client = new Client({
    authStrategy: new LocalAuth()
});

// ================== CONFIG ==================
const ADMIN_NUMBER = '6285872049687@c.us';
const SHEET_ID = '1JDz9EmUd3tFnEqIcN-rQi0JAysCxCEscySLOlu3AC80';
const creds = require('./service-account.json');

// ================== SESSION ==================
const sessions = {};

// ================== LAYANAN ==================
const layananMap = {
    1: 'Penambalan estetik',
    2: 'Cabut gigi dewasa',
    3: 'Cabut gigi anak',
    4: 'Implan',
    5: 'Kawat gigi',
    6: 'Gigi palsu',
    7: 'Veneer'
};

// ================== GOOGLE SHEET ==================
const doc = new GoogleSpreadsheet(SHEET_ID);

async function initSheet() {
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    return doc.sheetsByIndex[0];
}

async function saveToSheet(data) {
    const sheet = await initSheet();
    await sheet.addRow({
        Nama: data.nama,
        NoHP: data.nohp,
        Layanan: data.layanan,
        Tanggal: data.tanggal,
        Jam: data.jam,
        Timestamp: new Date().toISOString()
    });
}

async function getBookedSlots(tanggal) {
    const sheet = await initSheet();
    const rows = await sheet.getRows();
    return rows
        .filter(r => r.Tanggal === tanggal)
        .map(r => r.Jam);
}

// ================== TIME SLOT ==================
function generateTimeSlots() {
    const slots = [];
    let hour = 12;
    let minute = 0;

    while (hour < 19 || (hour === 19 && minute === 0)) {
        slots.push(
            `${hour.toString().padStart(2, '0')}:${minute
                .toString()
                .padStart(2, '0')}`
        );
        minute += 30;
        if (minute === 60) {
            minute = 0;
            hour++;
        }
    }
    return slots;
}

// ================== STEP HELPER ==================
function goToStep(session, nextStep) {
    if (!session.history) session.history = [];
    if (session.step) session.history.push(session.step);
    session.step = nextStep;
}

// ================== QR ==================
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🤖 Bot Klinik Elsaa siap');
});

// ================== MESSAGE HANDLER ==================
client.on('message', async msg => {
    const text = msg.body.trim().toLowerCase();
    const user = msg.from;
    const chat = await msg.getChat();
    await chat.sendSeen();

    if (!sessions[user]) {
        sessions[user] = { step: 'MENU', history: [] };
    }

    const session = sessions[user];

    // ========= GLOBAL COMMAND =========

    const humanReply = async (message) => {
        try {
            await chat.sendStateTyping();
            const typingTime = Math.floor(Math.random() * 2000) + 1500;
            await sleep(typingTime);
            return await msg.reply(message);
        } catch (err) {
            console.error("Gagal mengirim pesan (humanReply):", err);
        }
    };

    // MENU
    if (text === '0' || text === 'menu' || text === 'halo') {
        sessions[user] = { step: 'MENU', history: [] };
        return humanReply(
            '🦷 *Klinik Gigi Elsaa*\n' +
            '🕒 Jam praktek: 12.00 – 19.30\n\n' +
            'Pilih menu:\n' +
            '1. Booking Appointment\n' +
            '2. Jam Praktek\n' +
            '3. Jenis Layanan'
        );
    }

    // CANCEL
    if (text === '#') {
        delete sessions[user];
        return humanReply(
            '❌ *Booking dibatalkan*\n\nKetik *menu* untuk mulai lagi.'
        );
    }

    // BACK
    if (text === '9') {
        session.step =
            session.history.length > 0 ? session.history.pop() : 'MENU';

        return humanReply('🔙 Kembali ke langkah sebelumnya');
    }


    // ========= MENU =========
    if (session.step === 'MENU') {
        if (text === '1') {
            goToStep(session, 'PILIH_LAYANAN');
            return humanReply(
                'Pilih jenis layanan:\n' +
                Object.entries(layananMap)
                    .map(([k, v]) => `${k}. ${v}`)
                    .join('\n') +
                '\n\n0. Kembali'
            );
        }

        if (text === '2') {
            return humanReply('🕒 Jam praktek: 12.00 – 19.30' +
                '\n\n0. Kembali');
        }

        if (text === '3') {
            return humanReply(
                'Jenis layanan:\n' + Object.values(layananMap).join('\n') +
                '\n\n0. Kembali'
            );
        }
    }

    // ========= PILIH LAYANAN =========
    if (session.step === 'PILIH_LAYANAN') {
        if (!layananMap[text]) {
            return humanReply('Pilih angka 1–7 ya 🙂');
        }

        session.layanan = layananMap[text];
        goToStep(session, 'PILIH_TANGGAL');

        return humanReply(
            'Masukkan tanggal appointment\n' +
            'Format: YYYY-MM-DD\n\n9. Kembali\n0. Menu\n#. Batal'
        );
    }

    // ========= PILIH TANGGAL =========
    if (session.step === 'PILIH_TANGGAL') {
        if (!dayjs(text, 'YYYY-MM-DD', true).isValid()) {
            return humanReply('Format salah. Contoh: 2026-02-15');
        }

        session.tanggal = text;

        const booked = await getBookedSlots(text);
        const allSlots = generateTimeSlots();
        const available = allSlots.filter(s => !booked.includes(s));

        if (available.length === 0) {
            delete sessions[user];
            return humanReply('❌ Semua jam di tanggal ini sudah penuh.');
        }

        session.availableSlots = available;
        goToStep(session, 'PILIH_JAM');

        return humanReply(
            'Pilih jam tersedia:\n' +
            available.map((s, i) => `${i + 1}. ${s}`).join('\n') +
            '\n\n9. Kembali\n0. Menu\n#. Batal'
        );
    }

    // ========= PILIH JAM =========
    if (session.step === 'PILIH_JAM') {
        const index = parseInt(text);

        if (isNaN(index) || !session.availableSlots[index - 1]) {
            return humanReply('Pilih jam yang tersedia ya 🙂');
        }

        session.jam = session.availableSlots[index - 1];
        goToStep(session, 'KONFIRMASI');

        return humanReply(
            '🦷 *Konfirmasi Appointment*\n\n' +
            `Layanan: ${session.layanan}\n` +
            `Tanggal: ${session.tanggal}\n` +
            `Jam: ${session.jam}\n\n` +
            '1. Konfirmasi\n9. Kembali\n#. Batal'
        );
    }

    // ========= KONFIRMASI =========
    // ========= KONFIRMASI =========
    if (session.step === 'KONFIRMASI') {
        if (text === '1') {
            try {
                await saveToSheet({
                    nama: msg._data.notifyName || '-',
                    nohp: user,
                    layanan: session.layanan,
                    tanggal: session.tanggal,
                    jam: session.jam
                });

                // Bungkus notifikasi admin agar jika gagal, bot tidak mati
                try {
                    await client.sendMessage(
                        ADMIN_NUMBER,
                        '📢 *BOOKING BARU*\n\n' +
                        `Nama: ${msg._data.notifyName || '-'}\n` +
                        `No HP: ${user}\n` +
                        `Layanan: ${session.layanan}\n` +
                        `Tanggal: ${session.tanggal}\n` +
                        `Jam: ${session.jam}`
                    );
                } catch (adminErr) {
                    console.error("Gagal mengirim notifikasi ke Admin:", adminErr);
                }

                delete sessions[user];

                return await humanReply('✅ *Appointment berhasil dicatat*\nAdmin akan menghubungi Anda.');
            } catch (error) {
                console.error("Gagal menyimpan ke Sheet:", error);
                return await humanReply('❌ Terjadi kesalahan saat menyimpan data. Silakan coba lagi nanti.');
            }
        }
    }
});

client.initialize();
