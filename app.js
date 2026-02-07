const connectBtn = document.getElementById('connectBtn');
const printBtn = document.getElementById('printBtn');
const statusText = document.getElementById('status-text');
const statusIndicator = document.getElementById('status-indicator');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const imagePreview = document.getElementById('imagePreview');
const previewContainer = document.getElementById('previewContainer');
const densitySlider = document.getElementById('densitySlider');
const densityValue = document.getElementById('densityValue');

let printerDevice = null;
let printerCharacteristic = null;
let currentImage = null; // To store the loaded Image object
let printQueue = [];
let isPrinting = false;

// Known UUIDs for thermal printers (Standard and common Chinese clones)
const SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb', // Standard 16-bit UUID for Print Service
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Commonly used by 'MTP' or 'BlueTooth Printer'
    '0000ffe0-0000-1000-8000-00805f9b34fb'  // HM-10 / JDY-08 often used in cheap modules
];

// --- 1. Connection Logic ---

connectBtn.addEventListener('click', async () => {
    try {
        statusText.textContent = "กำลังค้นหา...";

        // Request any device that advertises known services OR try generic access
        // Note: For Android/Chrome, you often need to list all optional services you might want to access
        printerDevice = await navigator.bluetooth.requestDevice({
            filters: [
                { services: SERVICE_UUIDS }
            ],
            optionalServices: SERVICE_UUIDS // Crucial to access them later
        }).catch(err => {
            // Fallback: accept all devices if specific filters fail (User just has to pick carefully)
            console.log("Filter failed, trying allow all...", err);
            return navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: SERVICE_UUIDS
            });
        });

        statusText.textContent = "กำลังเชื่อมต่อ...";

        const server = await printerDevice.gatt.connect();
        console.log("Connected to GATT Server");

        // Find a writable characteristic
        // We iterate through known services to find the correct one
        let service = null;
        for (const uuid of SERVICE_UUIDS) {
            try {
                service = await server.getPrimaryService(uuid);
                console.log("Found service:", uuid);
                break;
            } catch (e) {
                // Service not found, try next
            }
        }

        if (!service) {
            // As a last ditch effort, list all services (if browser allows) or throw error
            throw new Error("ไม่พบ Service สำหรับพิมพ์ (โปรดตรวจสอบรุ่นเครื่องพิมพ์)");
        }

        const characteristics = await service.getCharacteristics();
        // Look for a characteristic that supports WRITE or WRITE_WITHOUT_RESPONSE
        printerCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

        if (!printerCharacteristic) {
            throw new Error("ไม่พบช่องทางส่งข้อมูล (Characteristic Error)");
        }

        // Success!
        statusIndicator.classList.remove('offline');
        statusIndicator.classList.add('online');
        statusText.textContent = `เชื่อมต่อกับ ${printerDevice.name} แล้ว`;
        connectBtn.style.display = 'none'; // Hide connect button

        // Enable print if image is ready
        if (currentImage) printBtn.disabled = false;

        printerDevice.addEventListener('gattserverdisconnected', onDisconnected);

    } catch (error) {
        console.error(error);
        statusText.textContent = "การเชื่อมต่อล้มเหลว: " + error.message;
        alert("เชื่อมต่อไม่ได้: " + error.message);
    }
});

function onDisconnected() {
    statusIndicator.classList.remove('online');
    statusIndicator.classList.add('offline');
    statusText.textContent = "ขาดการเชื่อมต่อ";
    connectBtn.style.display = 'inline-flex';
    printBtn.disabled = true;
    printerDevice = null;
    printerCharacteristic = null;
}

// --- 2. File Handling Logic ---

fileInput.addEventListener('change', handleFileSelect);

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('is-active');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-active');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-active');

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        fileInput.files = e.dataTransfer.files; // Update input
        handleFileSelect({ target: fileInput });
    }
});

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            currentImage = img;
            imagePreview.src = img.src;
            previewContainer.style.display = 'block';

            if (printerCharacteristic) {
                printBtn.disabled = false;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- 3. Printing Logic ---

densitySlider.addEventListener('input', (e) => {
    densityValue.textContent = e.target.value;
});

printBtn.addEventListener('click', async () => {
    if (!printerCharacteristic || !currentImage) return;

    printBtn.disabled = true;
    printBtn.textContent = "กำลังส่งข้อมูล...";

    try {
        const encoder = new EscPosEncoder();

        // 1. Initialize
        /* Not always needed and might print garbage on some cheap printers, 
           but good for standard ones. 
           Let's skip init for now to be safe with generic raw data 
           or just rely on the image command. */
        // encoder.initialize();

        // 2. Raster Image
        const density = parseInt(densitySlider.value, 10);
        // Standard width for many 58mm POS printers is 384 dots.
        // For higher res or 80mm it might be 576.
        // We'll stick to 384 for "Mini Print" (usually 2 inches).
        encoder.raster(currentImage, 384, density); // Width 384, Threshold from slider

        // 3. Feed and Cut (if supported, mostly just feed)
        encoder.feed(4);

        const data = encoder.encode();

        // 4. Send Data in Chunks
        await sendDataInChunks(data);

        alert("ส่งคำสั่งพิมพ์เรียบร้อย!");

    } catch (err) {
        console.error(err);
        alert("เกิดข้อผิดพลาดในการพิมพ์: " + err.message);
    } finally {
        printBtn.disabled = false;
        printBtn.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
            </svg> พิมพ์ทันที
        `;
    }
});

async function sendDataInChunks(data) {
    // BLE 4.0 MTU is usually 23 bytes (20 payload).
    // However, some devices support larger writes or negotiate it.
    // To match "Mini Print" app behavior (which is usually slightly slow but reliable),
    // we use a safe chunk size (e.g., 50-100 bytes) and a delay.

    // Determine optimal chunk size based on MTU if possible, but 128 is safe
    const CHUNK_SIZE = 100;
    const DELAY_MS = 20;

    // Prefer "Write Without Response" for image data as it's much faster (no ack required)
    const canWriteWithoutResponse = printerCharacteristic.properties.writeWithoutResponse;

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);

        if (canWriteWithoutResponse) {
            await printerCharacteristic.writeValueWithoutResponse(chunk);
        } else {
            await printerCharacteristic.writeValue(chunk);
        }

        // Small delay to prevent buffer overflow on the printer
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
}
