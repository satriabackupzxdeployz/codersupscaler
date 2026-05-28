document.getElementById('upscalerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const urlInput = document.getElementById('imageUrl').value;
    const resolutionInput = document.getElementById('resolution').value;
    const startBtn = document.getElementById('startBtn');
    const loading = document.getElementById('loading');
    const resultContainer = document.getElementById('resultContainer');
    const resultImage = document.getElementById('resultImage');
    const downloadBtn = document.getElementById('downloadBtn');
    const successMessage = document.getElementById('successMessage');

    startBtn.disabled = true;
    loading.classList.remove('hidden');
    resultContainer.classList.add('hidden');

    try {
        const response = await fetch('/api/index', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: urlInput,
                resolution: resolutionInput
            })
        });

        const data = await response.json();

        if (data.status) {
            successMessage.textContent = data.message;
            resultImage.src = data.result;
            downloadBtn.href = data.download;
            resultContainer.classList.remove('hidden');
        } else {
            alert(data.message || "Gagal memproses gambar.");
        }
    } catch (error) {
        alert("Terjadi kesalahan pada jaringan server.");
    } finally {
        startBtn.disabled = false;
        loading.classList.add('hidden');
    }
});document.getElementById