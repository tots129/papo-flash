// Configuração do app da Web do Firebase (projeto papo-flash).
// Estas informações não são senha: podem ficar no GitHub sem problema.
export const firebaseConfig = {
  apiKey: 'AIzaSyB_fxdLygB_3avJnj7ICQ6wFrnJUJl8zDQ',
  authDomain: 'papo-flash.firebaseapp.com',
  projectId: 'papo-flash',
  storageBucket: 'papo-flash.firebasestorage.app',
  messagingSenderId: '249702972151',
  appId: '1:249702972151:web:0f6db80f73f6671d74f1f2',
};


// Chamadas de voz e vídeo: "pontes" extras (TURN) para quando a ligação não conecta no 4G.
// Deixe vazio por enquanto. Se precisar, o Claude te ajuda a preencher.
export const iceServers = [];
