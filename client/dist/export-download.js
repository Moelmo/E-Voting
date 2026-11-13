document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  const label = button?.textContent?.trim();
  const format = label === 'Format Excel (.xlsx)' ? 'xlsx' : label === 'Format CSV (.csv)' ? 'csv' : null;

  if (!format) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const token = localStorage.getItem('admin_token');
  if (!token) {
    alert('Sesi admin tidak ditemukan. Silakan login kembali.');
    return;
  }

  const selects = document.querySelectorAll('select');
  const search = document.querySelector('input[placeholder="Cari nama atau NIS siswa..."]');
  const params = new URLSearchParams({
    format,
    classFilter: selects[0]?.value || '',
    statusFilter: selects[1]?.value || '',
    q: search?.value || ''
  });

  try {
    const response = await fetch(`/api/admin/students/export?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Gagal mengekspor data siswa.');
    }

    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `data-siswa.${format}`;
    link.href = blobUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (error) {
    alert(error.message || 'Gagal mengekspor data siswa.');
  }
}, true);