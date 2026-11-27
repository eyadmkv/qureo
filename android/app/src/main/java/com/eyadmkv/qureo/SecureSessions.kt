package com.eyadmkv.qureo

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class EncryptedStore(context: Context) {
    private val preferences = context.getSharedPreferences("secure_sessions", Context.MODE_PRIVATE)
    private val alias = "eyadmkv.qureo.session.v1"

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(alias, null) as? SecretKey
        if (existing != null) return existing

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    @Synchronized
    fun put(name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val encrypted = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        preferences.edit().putString(name, "$iv.$encrypted").apply()
    }

    @Synchronized
    fun get(name: String): String? {
        val stored = preferences.getString(name, null) ?: return null
        val parts = stored.split('.', limit = 2)
        if (parts.size != 2) {
            preferences.edit().remove(name).apply()
            return null
        }

        return try {
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(encrypted), Charsets.UTF_8)
        } catch (error: Exception) {
            throw IllegalStateException("Could not decrypt the saved $name data. Sign in again.", error)
        }
    }

    fun remove(name: String) {
        preferences.edit().remove(name).apply()
    }
}

class PersistentCookieJar(
    context: Context,
    private val store: EncryptedStore,
    private val storageKey: String
) : CookieJar {
    private val lock = Any()
    private var cookies: MutableList<Cookie> = readCookies(context)

    private fun readCookies(context: Context): MutableList<Cookie> {
        val raw = store.get(storageKey) ?: return mutableListOf()
        return try {
            val array = JSONArray(raw)
            val result = mutableListOf<Cookie>()
            for (index in 0 until array.length()) {
                val row = array.optJSONObject(index) ?: continue
                val host = row.optString("domain")
                val builder = Cookie.Builder()
                    .name(row.optString("name"))
                    .value(row.optString("value"))
                if (row.optBoolean("hostOnly")) builder.hostOnlyDomain(host) else builder.domain(host)
                builder.path(row.optString("path", "/"))
                val expiresAt = row.optLong("expiresAt", Long.MAX_VALUE)
                if (expiresAt != Long.MAX_VALUE) builder.expiresAt(expiresAt)
                if (row.optBoolean("secure")) builder.secure()
                if (row.optBoolean("httpOnly")) builder.httpOnly()
                builder.build().let(result::add)
            }
            result
        } catch (_: Exception) {
            store.remove(storageKey)
            mutableListOf()
        }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        synchronized(lock) {
            for (cookie in cookies) {
                this.cookies.removeAll {
                    it.name() == cookie.name() &&
                        it.domain() == cookie.domain() &&
                        it.path() == cookie.path()
                }
                if (cookie.expiresAt() > System.currentTimeMillis()) this.cookies.add(cookie)
            }
            persist()
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            cookies.removeAll { it.expiresAt() <= now }
            return cookies.filter { it.matches(url) }
        }
    }

    fun cookieHeader(url: HttpUrl): String = loadForRequest(url).joinToString("; ") {
        "${it.name()}=${it.value()}"
    }

    fun clear() {
        synchronized(lock) {
            cookies.clear()
            store.remove(storageKey)
        }
    }

    private fun persist() {
        val array = JSONArray()
        for (cookie in cookies) {
            array.put(
                JSONObject()
                    .put("name", cookie.name())
                    .put("value", cookie.value())
                    .put("domain", cookie.domain())
                    .put("path", cookie.path())
                    .put("expiresAt", cookie.expiresAt())
                    .put("hostOnly", cookie.hostOnly())
                    .put("secure", cookie.secure())
                    .put("httpOnly", cookie.httpOnly())
            )
        }
        store.put(storageKey, array.toString())
    }

    fun hasCookies(): Boolean = synchronized(lock) { cookies.isNotEmpty() }
}
