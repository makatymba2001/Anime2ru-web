function deleteSection(id){
    let http = new XMLHttpRequest;
    http.open('GET', '/deleteSection/' + id);
    http.onreadystatechange = () => {
        if (http.readyState != 4) return;
        if (http.status === 200) location.reload()
    }
    http.send();
}
function showCreateSectionPanel(id){
    document.getElementById('section-creator-background').classList.add('visible');
    document.getElementById('creator-section-parent-id').value = id || 0;
}
function hideCreateSectionPanel(){
    document.getElementById('section-creator-background').classList.remove('visible');
}
function createSection(){
    let http = new XMLHttpRequest();
    http.open('POST', '/createSection');
    http.setRequestHeader('Content-Type', 'application/json');
    if (document.getElementById('creator-section-image-file').files.length){
        let reader = new FileReader();
        reader.readAsDataURL(document.getElementById('creator-section-image-file').files[0])
        reader.onload = () => {
        http.send(JSON.stringify({
                title: document.getElementById('creator-section-title').value,
                description: document.getElementById('creator-section-description').value,
                parent_id: document.getElementById('creator-section-parent-id').value,
                image_link: null,
                image_file: reader.result
            }))
        }
    }
    else{
        http.send(JSON.stringify({
                title: document.getElementById('creator-section-title').value,
                description: document.getElementById('creator-section-description').value,
                parent_id: document.getElementById('creator-section-parent-id').value,
                image_link: document.getElementById('creator-section-image-link').value,
                image_file: null
        }))
    }
    http.onreadystatechange = () => {
        if (http.readyState != 4) return;
        if (!http.status === 200) console.error(http.responseText)
        if (http.status === 200) location.reload()
    }
}