package tech.pingsell.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PingsellTest {
    @Test
    fun recognisesPingsellMessages() {
        assertTrue(Pingsell.isPingsellMessage(mapOf("pingsell_message_id" to "m1")))
        assertTrue(Pingsell.isPingsellMessage(mapOf("pingsell_inbox_id" to "i1")))
        assertFalse(Pingsell.isPingsellMessage(mapOf("screen" to "reservation", "reserv_id" to "12")))
    }

    @Test
    fun buildsNotificationFromData() {
        val n = Pingsell.toNotification(
            "Titre",
            "Texte",
            mapOf(
                "pingsell_message_id" to "m1",
                "url" to "https://nightsquare.org/events",
                "google.message_id" to "0:123",
                "from" to "1234",
                "event_id" to "42",
            ),
        )
        assertEquals("m1", n.messageId)
        assertNull(n.inboxId)
        assertEquals("https://nightsquare.org/events", n.url)
        assertEquals(mapOf("pingsell_message_id" to "m1", "url" to "https://nightsquare.org/events", "event_id" to "42"), n.data)
    }
}
